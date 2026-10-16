// All game logic lives in the TypeScript frontend; the Rust side only hosts the window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running imaplaypoker");
}
