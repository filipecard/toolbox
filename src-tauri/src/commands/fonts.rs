use font_kit::source::SystemSource;

/// Lists installed font family names so Settings can offer a real picker
/// instead of a fixed list — sourced straight from the OS (DirectWrite on
/// Windows via `font-kit`), not hardcoded.
///
/// Async + spawn_blocking: a sync command runs on the main thread, so
/// enumerating every installed font there stalled input (scrolling,
/// checkboxes) while Settings was opening.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut families = SystemSource::new()
            .all_families()
            .map_err(|e| e.to_string())?;
        families.sort();
        families.dedup();
        Ok(families)
    })
    .await
    .map_err(|e| e.to_string())?
}
