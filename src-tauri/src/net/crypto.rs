//! Room codes, the password-authenticated handshake, and encrypted framing.
//!
//! The room code is the SPAKE2 password: it never travels over the wire, and a
//! recorded handshake can't be brute-forced offline. Each side then proves it
//! derived the same key (HMAC key confirmation), and every later frame is
//! ChaCha20-Poly1305 with a per-direction key and a counter nonce, so tampered,
//! replayed or reordered frames are rejected.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Crockford base32: no I, L, O or U, so codes are easy to read aloud.
const CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const CODE_LEN: usize = 8;

const MAGIC: &[u8; 4] = b"IMPK";
const VERSION: u8 = 1;
const ID_CLIENT: &[u8] = b"imaplaypoker client";
const ID_HOST: &[u8] = b"imaplaypoker host";
/// Handshake frames are tiny; anything bigger is garbage.
const MAX_HANDSHAKE_FRAME: usize = 128;
const TAG_LEN: usize = 16;

/// Host's first reply byte.
pub const STATUS_OK: u8 = 0;
pub const STATUS_FULL: u8 = 1;
pub const STATUS_PAUSED: u8 = 2;

#[derive(Debug, PartialEq, Eq)]
pub enum NetError {
    Io,
    /// Peer closed the connection cleanly.
    Closed,
    /// Bad magic/version/length or a frame that failed authentication.
    Protocol,
    FrameTooLarge,
    WrongCode,
    Full,
    Paused,
}

impl NetError {
    pub fn code(&self) -> &'static str {
        match self {
            NetError::Io => "io",
            NetError::Closed => "closed",
            NetError::Protocol => "protocol",
            NetError::FrameTooLarge => "tooLarge",
            NetError::WrongCode => "wrongCode",
            NetError::Full => "full",
            NetError::Paused => "paused",
        }
    }
}

fn io_err(e: std::io::Error) -> NetError {
    if e.kind() == std::io::ErrorKind::UnexpectedEof {
        NetError::Closed
    } else {
        NetError::Io
    }
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("system random number generator unavailable");
    buf
}

/// A fresh room code from the OS CSPRNG (8 × 5 bits = 40 bits).
pub fn generate_code() -> String {
    // 32 divides 256, so taking the low 5 bits of each byte is unbiased.
    random_bytes::<CODE_LEN>()
        .iter()
        .map(|b| CODE_ALPHABET[(b & 31) as usize] as char)
        .collect()
}

/// Canonical form of a typed code: uppercase, separators dropped, and the
/// look-alike letters folded the Crockford way. `None` if it can't be a code.
pub fn normalize_code(input: &str) -> Option<String> {
    let mut out = String::with_capacity(CODE_LEN);
    for c in input.chars() {
        let c = match c.to_ascii_uppercase() {
            ' ' | '-' | '_' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        if !CODE_ALPHABET.contains(&(c as u8)) || !c.is_ascii() {
            return None;
        }
        out.push(c);
    }
    (out.len() == CODE_LEN).then_some(out)
}

/// Directional keys agreed by the handshake.
pub struct SessionKeys {
    pub send: [u8; 32],
    pub recv: [u8; 32],
}

struct Derived {
    client_to_host: [u8; 32],
    host_to_client: [u8; 32],
    confirm_host: [u8; 32],
    confirm_client: [u8; 32],
}

fn derive(shared: &[u8], msg_a: &[u8], msg_b: &[u8]) -> Derived {
    let transcript = Sha256::new()
        .chain_update(b"imaplaypoker-v1")
        .chain_update(msg_a)
        .chain_update(msg_b)
        .finalize();
    let hk = Hkdf::<Sha256>::new(Some(&transcript), shared);
    let mut out = Derived {
        client_to_host: [0; 32],
        host_to_client: [0; 32],
        confirm_host: [0; 32],
        confirm_client: [0; 32],
    };
    hk.expand(b"c2h key", &mut out.client_to_host).unwrap();
    hk.expand(b"h2c key", &mut out.host_to_client).unwrap();
    hk.expand(b"host confirm", &mut out.confirm_host).unwrap();
    hk.expand(b"client confirm", &mut out.confirm_client).unwrap();
    out
}

fn mac(key: &[u8; 32], label: &[u8]) -> [u8; 32] {
    let mut m = <Hmac<Sha256>>::new_from_slice(key).unwrap();
    m.update(label);
    m.finalize().into_bytes().into()
}

fn mac_ok(key: &[u8; 32], label: &[u8], tag: &[u8]) -> bool {
    let mut m = <Hmac<Sha256>>::new_from_slice(key).unwrap();
    m.update(label);
    // Constant-time comparison.
    m.verify_slice(tag).is_ok()
}

async fn write_plain<S: AsyncWrite + Unpin>(s: &mut S, data: &[u8]) -> Result<(), NetError> {
    s.write_u32(data.len() as u32).await.map_err(io_err)?;
    s.write_all(data).await.map_err(io_err)?;
    s.flush().await.map_err(io_err)
}

async fn read_plain<S: AsyncRead + Unpin>(s: &mut S, max: usize) -> Result<Vec<u8>, NetError> {
    let len = s.read_u32().await.map_err(io_err)? as usize;
    if len > max {
        return Err(NetError::FrameTooLarge);
    }
    let mut buf = vec![0u8; len];
    s.read_exact(&mut buf).await.map_err(io_err)?;
    Ok(buf)
}

/// Client side: proves knowledge of `code` and gets session keys.
pub async fn client_handshake<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S, code: &str) -> Result<SessionKeys, NetError> {
    let (spake, msg_a) = Spake2::<Ed25519Group>::start_a(
        &Password::new(code.as_bytes()),
        &Identity::new(ID_CLIENT),
        &Identity::new(ID_HOST),
    );
    let mut hello = Vec::with_capacity(5 + msg_a.len());
    hello.extend_from_slice(MAGIC);
    hello.push(VERSION);
    hello.extend_from_slice(&msg_a);
    write_plain(s, &hello).await?;

    let reply = read_plain(s, MAX_HANDSHAKE_FRAME).await?;
    match reply.first() {
        Some(&STATUS_OK) => {}
        Some(&STATUS_FULL) => return Err(NetError::Full),
        Some(&STATUS_PAUSED) => return Err(NetError::Paused),
        _ => return Err(NetError::Protocol),
    }
    // status (1) | spake msg_b (33) | host confirm (32)
    if reply.len() != 1 + msg_a.len() + 32 {
        return Err(NetError::Protocol);
    }
    let msg_b = &reply[1..1 + msg_a.len()];
    let shared = spake.finish(msg_b).map_err(|_| NetError::Protocol)?;
    let d = derive(&shared, &msg_a, msg_b);
    if !mac_ok(&d.confirm_host, b"host", &reply[1 + msg_a.len()..]) {
        return Err(NetError::WrongCode);
    }
    write_plain(s, &mac(&d.confirm_client, b"client")).await?;
    Ok(SessionKeys { send: d.client_to_host, recv: d.host_to_client })
}

/// What the host learned from a client's opening message.
pub struct ClientHello {
    msg_a: Vec<u8>,
}

/// Host side, step 1: read and check the client's opening message.
pub async fn host_read_hello<S: AsyncRead + Unpin>(s: &mut S) -> Result<ClientHello, NetError> {
    let hello = read_plain(s, MAX_HANDSHAKE_FRAME).await?;
    if hello.len() < 5 || &hello[..4] != MAGIC || hello[4] != VERSION {
        return Err(NetError::Protocol);
    }
    Ok(ClientHello { msg_a: hello[5..].to_vec() })
}

/// Host side: refuse before any key exchange (room full or paused).
pub async fn host_refuse<S: AsyncWrite + Unpin>(s: &mut S, status: u8) -> Result<(), NetError> {
    write_plain(s, &[status]).await
}

/// Host side, step 2: answer the key exchange and check the client's confirmation.
/// `WrongCode` means the client did not prove it knows the code, including a
/// client that hung up after seeing our confirmation, so callers count it as a failed guess.
pub async fn host_finish<S: AsyncRead + AsyncWrite + Unpin>(
    s: &mut S,
    hello: ClientHello,
    code: &str,
) -> Result<SessionKeys, NetError> {
    let (spake, msg_b) = Spake2::<Ed25519Group>::start_b(
        &Password::new(code.as_bytes()),
        &Identity::new(ID_CLIENT),
        &Identity::new(ID_HOST),
    );
    let shared = spake.finish(&hello.msg_a).map_err(|_| NetError::Protocol)?;
    let d = derive(&shared, &hello.msg_a, &msg_b);
    let mut reply = Vec::with_capacity(1 + msg_b.len() + 32);
    reply.push(STATUS_OK);
    reply.extend_from_slice(&msg_b);
    reply.extend_from_slice(&mac(&d.confirm_host, b"host"));
    write_plain(s, &reply).await?;

    let confirm = read_plain(s, MAX_HANDSHAKE_FRAME).await.map_err(|_| NetError::WrongCode)?;
    if !mac_ok(&d.confirm_client, b"client", &confirm) {
        return Err(NetError::WrongCode);
    }
    Ok(SessionKeys { send: d.host_to_client, recv: d.client_to_host })
}

fn nonce(counter: u64) -> Nonce {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&counter.to_be_bytes());
    Nonce::from(n)
}

/// Reads encrypted frames. Any failure is fatal for the connection.
pub struct FrameReader<R> {
    inner: R,
    cipher: ChaCha20Poly1305,
    counter: u64,
    max_plain: usize,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    pub fn new(inner: R, key: &[u8; 32], max_plain: usize) -> Self {
        Self { inner, cipher: ChaCha20Poly1305::new(&Key::from(*key)), counter: 0, max_plain }
    }

    pub async fn recv(&mut self) -> Result<Vec<u8>, NetError> {
        let frame = read_plain(&mut self.inner, self.max_plain + TAG_LEN).await?;
        let plain = self
            .cipher
            .decrypt(&nonce(self.counter), frame.as_slice())
            .map_err(|_| NetError::Protocol)?;
        self.counter += 1;
        Ok(plain)
    }
}

pub struct FrameWriter<W> {
    inner: W,
    cipher: ChaCha20Poly1305,
    counter: u64,
}

impl<W: AsyncWrite + Unpin> FrameWriter<W> {
    pub fn new(inner: W, key: &[u8; 32]) -> Self {
        Self { inner, cipher: ChaCha20Poly1305::new(&Key::from(*key)), counter: 0 }
    }

    pub async fn send(&mut self, plain: &[u8]) -> Result<(), NetError> {
        let frame = self
            .cipher
            .encrypt(&nonce(self.counter), plain)
            .map_err(|_| NetError::Protocol)?;
        self.counter += 1;
        write_plain(&mut self.inner, &frame).await
    }

    pub async fn shutdown(&mut self) {
        let _ = self.inner.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[test]
    fn codes_are_valid_and_normalize() {
        for _ in 0..200 {
            let c = generate_code();
            assert_eq!(c.len(), CODE_LEN);
            assert_eq!(normalize_code(&c).as_deref(), Some(c.as_str()));
        }
        assert_eq!(normalize_code("abcd-efgh").as_deref(), Some("ABCDEFGH"));
        assert_eq!(normalize_code("o0il 1234").as_deref(), Some("00111234"));
        assert_eq!(normalize_code("ABCDEFG"), None);
        assert_eq!(normalize_code("ABCDEFGHU"), None);
        assert_eq!(normalize_code("ABCDÉFGH"), None);
    }

    async fn run(host_code: &str, client_code: &str) -> (Result<SessionKeys, NetError>, Result<SessionKeys, NetError>) {
        let (mut a, mut b) = duplex(4096);
        let host_code = host_code.to_string();
        let host = tokio::spawn(async move {
            let hello = host_read_hello(&mut b).await?;
            host_finish(&mut b, hello, &host_code).await
        });
        let client = client_handshake(&mut a, client_code).await;
        drop(a);
        (host.await.unwrap(), client)
    }

    #[tokio::test]
    async fn right_code_agrees_on_keys() {
        let (h, c) = run("ABCDEFGH", "ABCDEFGH").await;
        let (h, c) = (h.unwrap(), c.unwrap());
        assert_eq!(h.send, c.recv);
        assert_eq!(h.recv, c.send);
        assert_ne!(h.send, h.recv);
    }

    #[tokio::test]
    async fn wrong_code_fails_both_sides() {
        let (h, c) = run("ABCDEFGH", "ABCDEFGJ").await;
        assert_eq!(c.err(), Some(NetError::WrongCode));
        assert_eq!(h.err(), Some(NetError::WrongCode));
    }

    #[tokio::test]
    async fn frames_roundtrip_and_reject_tampering() {
        let key = random_bytes::<32>();
        let (a, b) = duplex(1 << 16);
        let mut w = FrameWriter::new(a, &key);
        let mut r = FrameReader::new(b, &key, 1024);
        w.send(b"hello").await.unwrap();
        w.send(b"world").await.unwrap();
        assert_eq!(r.recv().await.unwrap(), b"hello");
        assert_eq!(r.recv().await.unwrap(), b"world");

        // Oversized frame.
        w.send(&vec![0u8; 2048]).await.unwrap();
        assert_eq!(r.recv().await.err(), Some(NetError::FrameTooLarge));

        // Tampered ciphertext.
        let (mut a, b) = duplex(1 << 16);
        let cipher = ChaCha20Poly1305::new(&Key::from(key));
        let mut ct = cipher.encrypt(&nonce(0), b"x".as_slice()).unwrap();
        ct[0] ^= 1;
        write_plain(&mut a, &ct).await.unwrap();
        let mut r = FrameReader::new(b, &key, 1024);
        assert_eq!(r.recv().await.err(), Some(NetError::Protocol));

        // Replayed frame (counter mismatch).
        let (a, b) = duplex(1 << 16);
        let mut w = FrameWriter::new(a, &key);
        w.send(b"once").await.unwrap();
        w.counter = 0;
        w.send(b"once").await.unwrap();
        let mut r = FrameReader::new(b, &key, 1024);
        assert!(r.recv().await.is_ok());
        assert_eq!(r.recv().await.err(), Some(NetError::Protocol));
    }
}
