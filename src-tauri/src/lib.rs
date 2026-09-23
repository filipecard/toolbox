mod commands;
mod state;
mod window_registry;

use commands::clipboard::{clear_clipboard_history, list_clipboard_history, remove_clipboard_entry};
use commands::compressor::{compressor_quota, consume_compressor_use};
use commands::file_search::{
    default_search_root, ensure_file_index, file_index_status, search_files,
};
use commands::fonts::list_system_fonts;
use commands::notes::{create_note, delete_note, list_notes, load_note, rename_note, save_note};
use commands::ocr::{extract_text_from_image, ocr_quota};
use commands::reminders::{add_reminder, list_reminders, remove_reminder};
use commands::transcribe::{
    get_whisper_model_path, set_whisper_model_path, transcribe_audio, transcribe_quota,
};
use commands::whisper_setup::{setup_whisper, whisper_setup_status};
use commands::windows::{
    collapse_note, collapse_notes_bar, collapse_quick_menu, collapse_tool, expand_tool,
    open_bubble, open_note, open_notes_bar, open_quick_menu, set_bubble_size, show_launcher,
};
use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                open_bubble(handle, "launcher".to_string())
                    .await
                    .expect("failed to create launcher bubble");
            });

            commands::clipboard::start_watcher(app.handle().clone());
            commands::reminders::start_watcher(app.handle().clone());

            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("ToolBox")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_launcher(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_bubble,
            set_bubble_size,
            open_quick_menu,
            collapse_quick_menu,
            expand_tool,
            collapse_tool,
            open_notes_bar,
            collapse_notes_bar,
            open_note,
            collapse_note,
            create_note,
            list_notes,
            load_note,
            save_note,
            rename_note,
            delete_note,
            list_system_fonts,
            extract_text_from_image,
            ocr_quota,
            list_clipboard_history,
            clear_clipboard_history,
            remove_clipboard_entry,
            compressor_quota,
            consume_compressor_use,
            transcribe_quota,
            get_whisper_model_path,
            set_whisper_model_path,
            transcribe_audio,
            whisper_setup_status,
            setup_whisper,
            list_reminders,
            add_reminder,
            remove_reminder,
            default_search_root,
            search_files,
            ensure_file_index,
            file_index_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
