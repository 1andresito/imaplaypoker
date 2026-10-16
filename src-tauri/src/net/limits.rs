//! Limits that keep a hosted room safe from guessing and flooding.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// Seats at a table, counting the host and bots.
pub const MAX_SEATS: usize = 8;
/// Remote players: every seat except the host's.
pub const MAX_REMOTE: usize = MAX_SEATS - 1;
/// Connections allowed to be mid-handshake at once.
pub const MAX_PENDING: usize = 16;
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Client → host messages are tiny (a hello or an action).
pub const MAX_HOST_INBOUND: usize = 16 * 1024;
/// Host → client: a full table view.
pub const MAX_CLIENT_INBOUND: usize = 512 * 1024;
/// Wrong codes from one address before it is ignored for the rest of the session.
pub const FAILS_PER_IP: u32 = 5;
/// Wrong codes in total before the room stops accepting joins until the code is changed.
pub const FAILS_TOTAL: u32 = 50;
/// Per-connection message rate: steady rate and burst.
pub const MSG_RATE: f64 = 20.0;
pub const MSG_BURST: f64 = 40.0;

/// Counts failed code attempts per address and overall.
#[derive(Default)]
pub struct FailureTracker {
    per_ip: HashMap<IpAddr, u32>,
    total: u32,
}

impl FailureTracker {
    pub fn is_banned(&self, ip: IpAddr) -> bool {
        self.per_ip.get(&ip).is_some_and(|&n| n >= FAILS_PER_IP)
    }

    /// Records a failure; returns true if the room should now pause.
    pub fn record(&mut self, ip: IpAddr) -> bool {
        *self.per_ip.entry(ip).or_default() += 1;
        self.total += 1;
        self.total >= FAILS_TOTAL
    }

    /// A new code makes earlier guesses worthless; bans stay.
    pub fn reset_total(&mut self) {
        self.total = 0;
    }
}

pub struct TokenBucket {
    tokens: f64,
    last: Instant,
    rate: f64,
    burst: f64,
}

impl TokenBucket {
    pub fn new(rate: f64, burst: f64) -> Self {
        Self { tokens: burst, last: Instant::now(), rate, burst }
    }

    pub fn allow(&mut self) -> bool {
        self.allow_at(Instant::now())
    }

    fn allow_at(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.rate).min(self.burst);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Addresses that may use LAN discovery: private, link-local and loopback only.
pub fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xffc0) == 0xfe80 || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bans_after_repeated_failures() {
        let mut t = FailureTracker::default();
        let a: IpAddr = "203.0.113.5".parse().unwrap();
        let b: IpAddr = "203.0.113.6".parse().unwrap();
        for _ in 0..FAILS_PER_IP - 1 {
            t.record(a);
        }
        assert!(!t.is_banned(a));
        t.record(a);
        assert!(t.is_banned(a));
        assert!(!t.is_banned(b));
    }

    #[test]
    fn pauses_after_many_total_failures() {
        let mut t = FailureTracker::default();
        let mut paused = false;
        for i in 0..FAILS_TOTAL {
            paused = t.record(IpAddr::from([10, 0, (i / 250) as u8, (i % 250) as u8]));
        }
        assert!(paused);
        t.reset_total();
        assert!(!t.record("10.9.9.9".parse().unwrap()));
    }

    #[test]
    fn token_bucket_limits_bursts() {
        let mut b = TokenBucket::new(10.0, 5.0);
        let t0 = b.last;
        let allowed = (0..20).filter(|_| b.allow_at(t0)).count();
        assert_eq!(allowed, 5);
        assert!(b.allow_at(t0 + Duration::from_millis(150)));
    }

    #[test]
    fn local_addresses() {
        for ip in ["192.168.1.4", "10.0.0.1", "172.16.5.5", "127.0.0.1", "169.254.1.1", "::1", "fe80::1"] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "203.0.113.1", "2001:db8::1"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
    }
}
