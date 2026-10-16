// All game logic lives in the TypeScript frontend; the Rust side hosts the
// window, the auto-updater, and multiplayer networking (`net`).
mod net;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .manage(net::NetState::default())
        .invoke_handler(net::commands())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running imaplaypoker");
}
