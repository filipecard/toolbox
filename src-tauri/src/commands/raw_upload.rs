//! Helpers for commands that receive a file's bytes as the raw IPC body.
//!
//! Sending a file as a `Vec<u8>` command argument makes the frontend encode
//! it as a JSON array of numbers — roughly 4x the file's size in text, all
//! built and parsed in memory, which stalls on a big audio file. A raw body
//! skips JSON entirely; the other arguments travel as request headers.

use tauri::ipc::{InvokeBody, Request};

pub fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("Envio inválido: esperado o conteúdo do arquivo.".into()),
    }
}

pub fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

/// The file extension for a temp file, from a (URI-encoded) file name —
/// only short alphanumeric extensions pass, so nothing odd ever reaches a
/// file path.
pub fn safe_extension(file_name: Option<&str>, fallback: &str) -> String {
    file_name
        .and_then(|n| n.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::safe_extension;

    #[test]
    fn extensions_are_sanitized() {
        assert_eq!(safe_extension(Some("foto.JPG"), "png"), "jpg");
        assert_eq!(safe_extension(Some("Relat%C3%B3rio.pdf"), "png"), "pdf");
        assert_eq!(safe_extension(Some("semextensao"), "png"), "png");
        assert_eq!(safe_extension(Some("x.../../evil"), "png"), "png");
        assert_eq!(safe_extension(None, "wav"), "wav");
    }
}
