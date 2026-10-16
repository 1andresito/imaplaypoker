//! A player's connection to someone else's room.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::net::{lookup_host, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use super::crypto::{self, FrameReader, FrameWriter, NetError};
use super::host::validate_json;
use super::limits::{HANDSHAKE_TIMEOUT, MAX_CLIENT_INBOUND};
use super::DEFAULT_PORT;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClientEvent {
    Message { json: String },
    Closed { reason: String },
}

pub type ClientSink = Arc<dyn Fn(ClientEvent) + Send + Sync>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub struct Client {
    tx: mpsc::Sender<Vec<u8>>,
    close: Option<oneshot::Sender<()>>,
}

/// "host", "host:port", "1.2.3.4", "[::1]:port" → something `lookup_host` accepts.
fn with_port(addr: &str) -> Option<String> {
    let addr = addr.trim();
    if addr.is_empty() || addr.len() > 255 || addr.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    if addr.parse::<std::net::SocketAddr>().is_ok() {
        return Some(addr.to_string());
    }
    if addr.parse::<std::net::IpAddr>().is_ok() {
        return Some(match addr.contains(':') {
            true => format!("[{addr}]:{DEFAULT_PORT}"),
            false => format!("{addr}:{DEFAULT_PORT}"),
        });
    }
    match addr.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && port.parse::<u16>().is_ok() => Some(addr.to_string()),
        Some(_) => None,
        None => Some(format!("{addr}:{DEFAULT_PORT}")),
    }
}

impl Client {
    /// Connects and authenticates. Errors are short codes the UI translates.
    pub async fn connect(addr: &str, code: &str, sink: ClientSink) -> Result<Client, String> {
        let code = crypto::normalize_code(code).ok_or("badCode")?;
        let target = with_port(addr).ok_or("badAddress")?;
        let addrs: Vec<_> = timeout(CONNECT_TIMEOUT, lookup_host(target))
            .await
            .map_err(|_| "unreachable")?
            .map_err(|_| "badAddress")?
            .collect();
        let mut stream = None;
        for a in addrs {
            if let Ok(Ok(s)) = timeout(CONNECT_TIMEOUT, TcpStream::connect(a)).await {
                stream = Some(s);
                break;
            }
        }
        let mut stream = stream.ok_or("unreachable")?;
        let _ = stream.set_nodelay(true);
        let keys = timeout(HANDSHAKE_TIMEOUT, crypto::client_handshake(&mut stream, &code))
            .await
            .map_err(|_| "timeout")?
            .map_err(|e| match e {
                // A host that hangs up mid-handshake has usually banned us or is not a room.
                NetError::Closed | NetError::Io => "refused",
                e => e.code(),
            })?;

        let (read_half, write_half) = stream.into_split();
        let mut reader = FrameReader::new(read_half, &keys.recv, MAX_CLIENT_INBOUND);
        let mut writer = FrameWriter::new(write_half, &keys.send);
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);
        let (close_tx, mut close_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                if writer.send(&data).await.is_err() {
                    break;
                }
            }
            writer.shutdown().await;
        });
        tokio::spawn(async move {
            let reason = loop {
                tokio::select! {
                    _ = &mut close_rx => return,
                    frame = reader.recv() => match frame {
                        Ok(data) => match validate_json(data) {
                            Some(json) => sink(ClientEvent::Message { json }),
                            None => break "badMessage",
                        },
                        Err(NetError::Closed) => break "closed",
                        Err(_) => break "error",
                    },
                }
            };
            sink(ClientEvent::Closed { reason: reason.into() });
        });
        Ok(Client { tx, close: Some(close_tx) })
    }

    pub async fn send(&self, data: Vec<u8>) -> bool {
        self.tx.send(data).await.is_ok()
    }

    pub fn try_send(&self, data: Vec<u8>) -> bool {
        self.tx.try_send(data).is_ok()
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        if let Some(close) = self.close.take() {
            let _ = close.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_get_default_port() {
        assert_eq!(with_port("192.168.1.5").unwrap(), format!("192.168.1.5:{DEFAULT_PORT}"));
        assert_eq!(with_port(" 192.168.1.5:5000 ").unwrap(), "192.168.1.5:5000");
        assert_eq!(with_port("::1").unwrap(), format!("[::1]:{DEFAULT_PORT}"));
        assert_eq!(with_port("[::1]:9").unwrap(), "[::1]:9");
        assert_eq!(with_port("example.com").unwrap(), format!("example.com:{DEFAULT_PORT}"));
        assert_eq!(with_port("example.com:80").unwrap(), "example.com:80");
        assert!(with_port("").is_none());
        assert!(with_port("a b").is_none());
        assert!(with_port("host:notaport").is_none());
    }
}
