mod account;
mod backup;
mod commands;
mod integrity;
mod plans;
mod state;
mod shortcuts;
mod storage;
mod window_registry;

use commands::clipboard::{
    add_clipboard_snippet, clear_clipboard_history, clipboard_image, copy_clipboard_entry,
    list_clipboard_history, remove_clipboard_entry, set_clipboard_pinned, update_clipboard_snippet,
};
use commands::pdf_compress::compress_pdf;
use commands::file_search::{
    default_search_root, ensure_file_index, file_index_status, search_files,
};
use commands::fonts::list_system_fonts;
use backup::{export_backup, import_backup};
use commands::notes::{
    create_note, delete_note, list_notes, load_note, rename_note, save_note, search_notes,
};
use commands::ocr::extract_text_from_image;
use commands::reminders::{add_reminder, list_reminders, remove_reminder};
use commands::setup::{autostart_enabled, set_autostart, take_installer_setup};
use commands::tool_install::remove_tool_components;
use commands::transcribe::{get_whisper_model_path, set_whisper_model_path, transcribe_audio};
use commands::whisper_setup::{setup_whisper, whisper_setup_status};
use commands::windows::{
    collapse_note, collapse_notes_bar, collapse_quick_menu, collapse_tool, expand_tool,
    open_bubble, open_from_quick_menu, open_note, open_notes_bar, open_quick_menu, set_bubble_size,
};
use account::dependencies::{dependency_status, install_dependency};
use account::{
    account_cancel_login, account_dev_mode, account_logout, account_open_site, account_retry,
    account_start_login, account_status,
};
use shortcuts::apply_shortcuts;
use plans::{consume_feature_use, feature_quota, plan_status};
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| shortcuts::handle(app, shortcut, event.state()))
                .build(),
        )
        .manage(AppState::default())
        .setup(|app| {
            storage::migrate_legacy(app.handle());

            // Opens the bubble if the saved session is valid, the sign-in
            // window otherwise (see account/).
            account::start(app.handle());

            commands::clipboard::start_watcher(app.handle().clone());
            commands::reminders::start_watcher(app.handle().clone());
            shortcuts::apply_from_settings(app.handle());

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
                        account::reveal(tray.app_handle());
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
            open_from_quick_menu,
            collapse_notes_bar,
            open_note,
            collapse_note,
            create_note,
            list_notes,
            load_note,
            save_note,
            rename_note,
            delete_note,
            search_notes,
            export_backup,
            import_backup,
            apply_shortcuts,
            account_status,
            account_start_login,
            account_cancel_login,
            account_retry,
            account_logout,
            account_open_site,
            account_dev_mode,
            take_installer_setup,
            autostart_enabled,
            set_autostart,
            dependency_status,
            install_dependency,
            remove_tool_components,
            list_system_fonts,
            extract_text_from_image,
            list_clipboard_history,
            clear_clipboard_history,
            remove_clipboard_entry,
            set_clipboard_pinned,
            add_clipboard_snippet,
            update_clipboard_snippet,
            copy_clipboard_entry,
            clipboard_image,
            compress_pdf,
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
            plan_status,
            feature_quota,
            consume_feature_use,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
