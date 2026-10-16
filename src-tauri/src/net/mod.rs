//! Multiplayer networking. The host's frontend runs the game; this module only
//! moves authenticated, encrypted, size- and rate-limited JSON between machines.

mod client;
mod crypto;
mod discovery;
mod host;
mod limits;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use client::Client;
use host::Host;

pub const DEFAULT_PORT: u16 = 47820;
pub const DISCOVERY_PORT: u16 = 47821;

#[derive(Default)]
pub struct NetState {
    host: Mutex<Option<Host>>,
    client: Mutex<Option<Client>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    code: String,
    port: u16,
    lan_ips: Vec<String>,
}

#[tauri::command]
async fn host_open(app: AppHandle, state: State<'_, NetState>, port: u16, room_name: String) -> Result<HostInfo, String> {
    if port != 0 && port < 1024 {
        return Err("portDenied".into());
    }
    if let Some(old) = state.host.lock().unwrap().take() {
        old.close();
    }
    let sink: host::HostSink = Arc::new(move |e| {
        let _ = app.emit("net-host", e);
    });
    let h = Host::open(port, &room_name, sink, Some(DISCOVERY_PORT)).await?;
    let info = HostInfo { code: h.code(), port: h.port(), lan_ips: discovery::lan_ips() };
    *state.host.lock().unwrap() = Some(h);
    Ok(info)
}

#[tauri::command]
fn host_send(state: State<'_, NetState>, conn_id: u64, json: String) -> bool {
    if json.len() > limits::MAX_CLIENT_INBOUND {
        return false;
    }
    state.host.lock().unwrap().as_ref().is_some_and(|h| h.send(conn_id, json.into_bytes()))
}

#[tauri::command]
fn host_kick(state: State<'_, NetState>, conn_id: u64) {
    if let Some(h) = state.host.lock().unwrap().as_ref() {
        h.kick(conn_id);
    }
}

#[tauri::command]
fn host_set_status(state: State<'_, NetState>, capacity: usize, seats_used: usize, open: bool) {
    if let Some(h) = state.host.lock().unwrap().as_ref() {
        h.set_status(capacity, seats_used, open);
    }
}

#[tauri::command]
fn host_regenerate_code(state: State<'_, NetState>) -> Option<String> {
    state.host.lock().unwrap().as_ref().map(|h| h.regenerate_code())
}

#[tauri::command]
fn host_close(state: State<'_, NetState>) {
    if let Some(h) = state.host.lock().unwrap().take() {
        h.close();
    }
}

#[tauri::command]
async fn client_join(app: AppHandle, state: State<'_, NetState>, address: String, code: String) -> Result<(), String> {
    state.client.lock().unwrap().take();
    let sink: client::ClientSink = Arc::new(move |e| {
        let _ = app.emit("net-client", e);
    });
    let c = Client::connect(&address, &code, sink).await?;
    *state.client.lock().unwrap() = Some(c);
    Ok(())
}

#[tauri::command]
fn client_send(state: State<'_, NetState>, json: String) -> bool {
    if json.len() > limits::MAX_HOST_INBOUND {
        return false;
    }
    state.client.lock().unwrap().as_ref().is_some_and(|c| c.try_send(json.into_bytes()))
}

#[tauri::command]
fn client_leave(state: State<'_, NetState>) {
    state.client.lock().unwrap().take();
}

#[tauri::command]
async fn discover_rooms() -> Vec<discovery::FoundRoom> {
    discovery::discover(DISCOVERY_PORT, Duration::from_millis(1200)).await
}

pub fn commands<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        host_open,
        host_send,
        host_kick,
        host_set_status,
        host_regenerate_code,
        host_close,
        client_join,
        client_send,
        client_leave,
        discover_rooms,
    ]
}
