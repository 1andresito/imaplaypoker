//! LAN room discovery over UDP broadcast.
//!
//! A probe is a fixed, padded datagram; a reply carries only the room's public
//! name, seat count and TCP port (never anything derived from the code). Hosts
//! answer local addresses only, and a reply is always smaller than the probe,
//! so the responder can't be used to amplify traffic at someone else.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;

use super::host::{clean_room_name, Shared};
use super::limits::{is_local, TokenBucket, MAX_SEATS};

const PROBE_MAGIC: &[u8] = b"IMPP-DISCOVER-1";
const PROBE_LEN: usize = 512;
const REPLY_MAGIC: &[u8] = b"IMPP-ROOM-1";

#[derive(Serialize, Deserialize)]
struct Advert {
    name: String,
    seats: usize,
    max: usize,
    port: u16,
}

#[derive(Serialize, Clone, Debug)]
pub struct FoundRoom {
    pub name: String,
    pub seats: usize,
    pub max: usize,
    /// "ip:port" to join.
    pub address: String,
}

fn probe() -> Vec<u8> {
    let mut p = vec![0u8; PROBE_LEN];
    p[..PROBE_MAGIC.len()].copy_from_slice(PROBE_MAGIC);
    p
}

pub(super) async fn respond(sock: UdpSocket, shared: Arc<Shared>) {
    let mut buf = [0u8; PROBE_LEN + 1];
    let mut bucket = TokenBucket::new(20.0, 20.0);
    loop {
        let Ok((len, from)) = sock.recv_from(&mut buf).await else { continue };
        if len != PROBE_LEN || !buf.starts_with(PROBE_MAGIC) || !is_local(from.ip()) {
            continue;
        }
        let advert = {
            let s = shared.status.lock().unwrap();
            if !s.open {
                continue;
            }
            Advert { name: s.name.clone(), seats: s.seats_used, max: MAX_SEATS, port: shared.port }
        };
        if !bucket.allow() {
            continue;
        }
        let mut reply = REPLY_MAGIC.to_vec();
        reply.extend(serde_json::to_vec(&advert).unwrap_or_default());
        if reply.len() < PROBE_LEN {
            let _ = sock.send_to(&reply, from).await;
        }
    }
}

fn parse_reply(data: &[u8], from: SocketAddr) -> Option<FoundRoom> {
    let body = data.strip_prefix(REPLY_MAGIC)?;
    let a: Advert = serde_json::from_slice(body).ok()?;
    if a.port == 0 {
        return None;
    }
    let ip = match from.ip() {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        ip => ip,
    };
    Some(FoundRoom {
        name: clean_room_name(&a.name),
        seats: a.seats.min(MAX_SEATS),
        max: MAX_SEATS,
        address: SocketAddr::new(ip, a.port).to_string(),
    })
}

/// Broadcasts a probe and collects replies for `wait`.
pub async fn discover(port: u16, wait: Duration) -> Vec<FoundRoom> {
    let Ok(sock) = UdpSocket::bind(("0.0.0.0", 0)).await else { return vec![] };
    let _ = sock.set_broadcast(true);
    let p = probe();
    let mut targets: HashSet<Ipv4Addr> = [Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST].into();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                if let Some(b) = v4.broadcast {
                    targets.insert(b);
                }
            }
        }
    }
    for t in targets {
        let _ = sock.send_to(&p, (t, port)).await;
    }

    let mut found: Vec<FoundRoom> = vec![];
    let mut buf = [0u8; PROBE_LEN];
    let deadline = tokio::time::Instant::now() + wait;
    while let Ok(Ok((len, from))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
        if !is_local(from.ip()) || found.len() >= 32 {
            continue;
        }
        if let Some(room) = parse_reply(&buf[..len], from) {
            if !found.iter().any(|r| r.address == room.address) {
                found.push(room);
            }
        }
    }
    // The same room is often heard on loopback and on the LAN; keep the LAN address.
    let lan: Vec<(String, String)> = found
        .iter()
        .filter(|r| !r.address.starts_with("127."))
        .map(|r| (r.name.clone(), r.address.rsplit(':').next().unwrap_or("").to_string()))
        .collect();
    found.retain(|r| {
        !r.address.starts_with("127.") || !lan.iter().any(|(n, p)| *n == r.name && r.address.ends_with(&format!(":{p}")))
    });
    found
}

/// Addresses other players can use to reach this computer on the LAN.
pub fn lan_ips() -> Vec<String> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else { return vec![] };
    let mut ips: Vec<String> = ifaces
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if !v4.is_link_local() => Some(v4.to_string()),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    ips
}

#[cfg(test)]
mod tests {
    use super::super::host::{Host, HostSink};
    use super::*;

    #[tokio::test]
    async fn finds_an_open_room_and_hides_a_closed_one() {
        let dport = 47_000 + (std::process::id() % 1000) as u16;
        let sink: HostSink = Arc::new(|_| {});
        let host = Host::open(0, "Kitchen table\u{7}", sink, Some(dport)).await.unwrap();
        host.set_status(5, 3, true);
        let rooms = discover(dport, Duration::from_millis(400)).await;
        let room = rooms.iter().find(|r| r.address.ends_with(&format!(":{}", host.port()))).expect("room found");
        assert_eq!(room.name, "Kitchen table");
        assert_eq!(room.seats, 3);

        host.set_status(5, 3, false);
        let rooms = discover(dport, Duration::from_millis(300)).await;
        assert!(rooms.iter().all(|r| !r.address.ends_with(&format!(":{}", host.port()))));
        host.close();
    }

    #[test]
    fn rejects_malformed_replies() {
        let from: SocketAddr = "192.168.1.9:47821".parse().unwrap();
        assert!(parse_reply(b"nope", from).is_none());
        assert!(parse_reply(b"IMPP-ROOM-1{\"name\":1}", from).is_none());
        let ok = parse_reply(br#"IMPP-ROOM-1{"name":"A","seats":99,"max":8,"port":5000}"#, from).unwrap();
        assert_eq!(ok.seats, MAX_SEATS);
        assert_eq!(ok.address, "192.168.1.9:5000");
    }
}
