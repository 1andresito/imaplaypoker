//! The host's listener: authenticates joiners with the room code, enforces the
//! limits in `limits.rs`, and relays validated JSON messages to the frontend,
//! which runs the actual game.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, oneshot, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinHandle;
use tokio::time::timeout;

use super::crypto::{self, FrameReader, FrameWriter, NetError, STATUS_FULL, STATUS_PAUSED};
use super::discovery;
use super::limits::*;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HostEvent {
    Joined { conn_id: u64, ip: String },
    Message { conn_id: u64, json: String },
    Left { conn_id: u64, reason: String },
    /// Too many wrong codes: joins are paused until the host picks a new code.
    Alert { alert: String },
}

pub type HostSink = Arc<dyn Fn(HostEvent) + Send + Sync>;

/// What LAN discovery advertises. Nothing here is secret.
#[derive(Clone, Default)]
pub struct RoomStatus {
    pub name: String,
    pub seats_used: usize,
    /// Accepting new players (lobby). Discovery stays quiet otherwise.
    pub open: bool,
}

struct Conn {
    tx: mpsc::Sender<Vec<u8>>,
    close: Option<oneshot::Sender<()>>,
}

pub(super) struct Shared {
    code: Mutex<String>,
    conns: Mutex<HashMap<u64, Conn>>,
    next_id: AtomicU64,
    /// Remote players allowed right now (seats left after the host and bots).
    capacity: Mutex<usize>,
    failures: Mutex<FailureTracker>,
    paused: AtomicBool,
    pending: Arc<Semaphore>,
    sink: HostSink,
    pub(super) status: Mutex<RoomStatus>,
    pub(super) port: u16,
}

pub struct Host {
    shared: Arc<Shared>,
    tasks: Vec<JoinHandle<()>>,
}

/// Outbound queue per connection; a client that can't keep up is dropped.
const OUTBOUND_QUEUE: usize = 64;

fn canonical_ip(addr: SocketAddr) -> IpAddr {
    match addr.ip() {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        ip => ip,
    }
}

/// Room names are shown to other players; keep them short and printable.
pub fn clean_room_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).take(24).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "Poker room".into() } else { trimmed.into() }
}

impl Host {
    /// Binds the listener (and LAN discovery, if its port is free).
    pub async fn open(port: u16, room_name: &str, sink: HostSink, discovery_port: Option<u16>) -> Result<Host, String> {
        let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::AddrInUse => "portInUse".to_string(),
            std::io::ErrorKind::PermissionDenied => "portDenied".to_string(),
            _ => "bindFailed".to_string(),
        })?;
        let port = listener.local_addr().map_err(|_| "bindFailed")?.port();
        let shared = Arc::new(Shared {
            code: Mutex::new(crypto::generate_code()),
            conns: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            capacity: Mutex::new(MAX_REMOTE),
            failures: Mutex::new(FailureTracker::default()),
            paused: AtomicBool::new(false),
            pending: Arc::new(Semaphore::new(MAX_PENDING)),
            sink,
            status: Mutex::new(RoomStatus { name: clean_room_name(room_name), seats_used: 1, open: true }),
            port,
        });
        let mut tasks = vec![tokio::spawn(accept_loop(listener, shared.clone()))];
        if let Some(dport) = discovery_port {
            // Discovery is a convenience: if another app holds the port, joining by address still works.
            if let Ok(sock) = UdpSocket::bind(("0.0.0.0", dport)).await {
                tasks.push(tokio::spawn(discovery::respond(sock, shared.clone())));
            }
        }
        Ok(Host { shared, tasks })
    }

    pub fn port(&self) -> u16 {
        self.shared.port
    }

    pub fn code(&self) -> String {
        self.shared.code.lock().unwrap().clone()
    }

    /// New code: unpauses joins and forgets the guess count (bans stay).
    pub fn regenerate_code(&self) -> String {
        let code = crypto::generate_code();
        *self.shared.code.lock().unwrap() = code.clone();
        self.shared.failures.lock().unwrap().reset_total();
        self.shared.paused.store(false, Ordering::SeqCst);
        code
    }

    pub fn set_status(&self, capacity: usize, seats_used: usize, open: bool) {
        *self.shared.capacity.lock().unwrap() = capacity.min(MAX_REMOTE);
        let mut s = self.shared.status.lock().unwrap();
        s.seats_used = seats_used.min(MAX_SEATS);
        s.open = open;
    }

    /// Queues a message. False if the connection is gone or too far behind (it is then dropped).
    pub fn send(&self, conn_id: u64, data: Vec<u8>) -> bool {
        let mut conns = self.shared.conns.lock().unwrap();
        let Some(conn) = conns.get(&conn_id) else { return false };
        if conn.tx.try_send(data).is_ok() {
            return true;
        }
        if let Some(mut c) = conns.remove(&conn_id) {
            if let Some(close) = c.close.take() {
                let _ = close.send(());
            }
        }
        false
    }

    /// Disconnects a client after flushing anything already queued for it.
    pub fn kick(&self, conn_id: u64) {
        if let Some(mut c) = self.shared.conns.lock().unwrap().remove(&conn_id) {
            if let Some(close) = c.close.take() {
                let _ = close.send(());
            }
        }
    }

    pub fn close(self) {
        for t in &self.tasks {
            t.abort();
        }
        for (_, mut c) in self.shared.conns.lock().unwrap().drain() {
            if let Some(close) = c.close.take() {
                let _ = close.send(());
            }
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    loop {
        let Ok((stream, addr)) = listener.accept().await else {
            // Usually out of file descriptors; back off instead of spinning.
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        };
        let ip = canonical_ip(addr);
        if shared.failures.lock().unwrap().is_banned(ip) {
            continue; // dropping the stream closes it
        }
        let Ok(permit) = shared.pending.clone().try_acquire_owned() else { continue };
        tokio::spawn(handle_conn(shared.clone(), stream, ip, permit));
    }
}

fn remote_count(shared: &Shared) -> usize {
    shared.conns.lock().unwrap().len()
}

async fn handle_conn(shared: Arc<Shared>, mut stream: TcpStream, ip: IpAddr, permit: OwnedSemaphorePermit) {
    let _ = stream.set_nodelay(true);
    // 0 = before hello, 1 = key exchange started (a failure now is a wrong guess).
    let mut stage = 0u8;
    let result = timeout(HANDSHAKE_TIMEOUT, async {
        let hello = crypto::host_read_hello(&mut stream).await?;
        if shared.paused.load(Ordering::SeqCst) {
            let _ = crypto::host_refuse(&mut stream, STATUS_PAUSED).await;
            return Err(NetError::Paused);
        }
        if remote_count(&shared) >= *shared.capacity.lock().unwrap() {
            let _ = crypto::host_refuse(&mut stream, STATUS_FULL).await;
            return Err(NetError::Full);
        }
        stage = 1;
        let code = shared.code.lock().unwrap().clone();
        crypto::host_finish(&mut stream, hello, &code).await
    })
    .await;
    drop(permit);

    let keys = match result {
        Ok(Ok(keys)) => keys,
        Ok(Err(NetError::WrongCode)) => return record_failure(&shared, ip),
        Err(_) if stage == 1 => return record_failure(&shared, ip),
        _ => return,
    };

    let conn_id = shared.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(OUTBOUND_QUEUE);
    let (close_tx, mut close_rx) = oneshot::channel();
    {
        let mut conns = shared.conns.lock().unwrap();
        // Re-check: several handshakes may have finished at once.
        if conns.len() >= *shared.capacity.lock().unwrap() {
            return;
        }
        conns.insert(conn_id, Conn { tx, close: Some(close_tx) });
    }
    (shared.sink)(HostEvent::Joined { conn_id, ip: ip.to_string() });

    let (read_half, write_half) = stream.into_split();
    let mut reader = FrameReader::new(read_half, &keys.recv, MAX_HOST_INBOUND);
    let mut writer = FrameWriter::new(write_half, &keys.send);
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if writer.send(&data).await.is_err() {
                break;
            }
        }
        writer.shutdown().await;
    });

    let mut bucket = TokenBucket::new(MSG_RATE, MSG_BURST);
    let reason = loop {
        tokio::select! {
            _ = &mut close_rx => break "kicked",
            frame = reader.recv() => match frame {
                Ok(data) => {
                    if !bucket.allow() {
                        break "flooding";
                    }
                    match validate_json(data) {
                        Some(json) => (shared.sink)(HostEvent::Message { conn_id, json }),
                        None => break "badMessage",
                    }
                }
                Err(NetError::Closed) => break "closed",
                Err(_) => break "error",
            },
        }
    };
    // Dropping the entry drops the sender, so the writer flushes and closes.
    shared.conns.lock().unwrap().remove(&conn_id);
    (shared.sink)(HostEvent::Left { conn_id, reason: reason.into() });
}

fn record_failure(shared: &Shared, ip: IpAddr) {
    let pause = shared.failures.lock().unwrap().record(ip);
    if pause && !shared.paused.swap(true, Ordering::SeqCst) {
        (shared.sink)(HostEvent::Alert { alert: "guessing".into() });
    }
}

/// Only well-formed JSON objects reach the frontend.
pub(super) fn validate_json(data: Vec<u8>) -> Option<String> {
    let text = String::from_utf8(data).ok()?;
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => Some(text),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::client::{Client, ClientEvent};
    use super::*;
    use std::time::Duration;

    fn collector<T: Send + 'static>() -> (Arc<dyn Fn(T) + Send + Sync>, mpsc::UnboundedReceiver<T>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(move |e| { let _ = tx.send(e); }), rx)
    }

    async fn next<T>(rx: &mut mpsc::UnboundedReceiver<T>) -> T {
        timeout(Duration::from_secs(5), rx.recv()).await.expect("timed out").expect("closed")
    }

    #[tokio::test]
    async fn host_and_two_clients_exchange_messages() {
        let (sink, mut events) = collector();
        let host = Host::open(0, "Test", sink, None).await.unwrap();
        let addr = format!("127.0.0.1:{}", host.port());

        let (csink1, mut c1_events) = collector();
        let c1 = Client::connect(&addr, &host.code(), csink1).await.unwrap();
        let (csink2, mut c2_events) = collector();
        let c2 = Client::connect(&addr, &host.code().to_lowercase(), csink2).await.unwrap();

        let HostEvent::Joined { conn_id: id1, .. } = next(&mut events).await else { panic!() };
        let HostEvent::Joined { conn_id: id2, .. } = next(&mut events).await else { panic!() };
        assert_ne!(id1, id2);

        assert!(c1.send(br#"{"t":"hello"}"#.to_vec()).await);
        assert_eq!(next(&mut events).await, HostEvent::Message { conn_id: id1, json: r#"{"t":"hello"}"#.into() });

        assert!(host.send(id2, br#"{"t":"welcome"}"#.to_vec()));
        assert_eq!(next(&mut c2_events).await, ClientEvent::Message { json: r#"{"t":"welcome"}"#.into() });

        // Non-object JSON disconnects the sender.
        assert!(c1.send(b"[1,2]".to_vec()).await);
        assert_eq!(next(&mut events).await, HostEvent::Left { conn_id: id1, reason: "badMessage".into() });
        assert!(matches!(next(&mut c1_events).await, ClientEvent::Closed { .. }));

        host.kick(id2);
        assert_eq!(next(&mut events).await, HostEvent::Left { conn_id: id2, reason: "kicked".into() });
        assert!(matches!(next(&mut c2_events).await, ClientEvent::Closed { .. }));
        drop(c2);
        host.close();
    }

    #[tokio::test]
    async fn wrong_codes_are_rejected_and_banned() {
        let (sink, _events) = collector();
        let host = Host::open(0, "Test", sink, None).await.unwrap();
        let addr = format!("127.0.0.1:{}", host.port());
        let wrong = if host.code() == "AAAAAAAA" { "BBBBBBBB" } else { "AAAAAAAA" };
        for _ in 0..FAILS_PER_IP {
            let (s, _) = collector();
            assert_eq!(Client::connect(&addr, wrong, s).await.err().as_deref(), Some("wrongCode"));
        }
        // Now even the right code is refused from this address.
        let (s, _) = collector();
        assert!(Client::connect(&addr, &host.code(), s).await.is_err());
        host.close();
    }

    #[tokio::test]
    async fn full_room_refuses_before_key_exchange() {
        let (sink, _events) = collector();
        let host = Host::open(0, "Test", sink, None).await.unwrap();
        host.set_status(1, 7, true);
        let addr = format!("127.0.0.1:{}", host.port());
        let (s1, _e1) = collector();
        let _c1 = Client::connect(&addr, &host.code(), s1).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let (s2, _e2) = collector();
        assert_eq!(Client::connect(&addr, &host.code(), s2).await.err().as_deref(), Some("full"));
        host.close();
    }

    #[tokio::test]
    async fn flooding_client_is_dropped() {
        let (sink, mut events) = collector();
        let host = Host::open(0, "Test", sink, None).await.unwrap();
        let addr = format!("127.0.0.1:{}", host.port());
        let (s, _e) = collector();
        let c = Client::connect(&addr, &host.code(), s).await.unwrap();
        for _ in 0..200 {
            if !c.send(br#"{"t":"x"}"#.to_vec()).await {
                break;
            }
        }
        loop {
            if let HostEvent::Left { reason, .. } = next(&mut events).await {
                assert_eq!(reason, "flooding");
                break;
            }
        }
        host.close();
    }
}
