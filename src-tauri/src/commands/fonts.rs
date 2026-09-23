use font_kit::source::SystemSource;

/// Lists installed font family names so Settings can offer a real picker
/// instead of a fixed list — sourced straight from the OS (DirectWrite on
/// Windows via `font-kit`), not hardcoded.
#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    let mut families = SystemSource::new()
        .all_families()
        .map_err(|e| e.to_string())?;
    families.sort();
    families.dedup();
    Ok(families)
}
