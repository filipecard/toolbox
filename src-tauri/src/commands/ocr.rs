use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Local-only placeholder for the real (server-enforced) paywall: a purely
/// client-side daily counter. Trivially bypassable (e.g. by editing
/// store.json), which is fine for now — genuine enforcement needs the
/// online licensing backend described in the monetization plan, which is a
/// separate, larger piece of work than this tool itself.
const FREE_DAILY_LIMIT: u32 = 1;
const USAGE_KEY: &str = "ocrUsage";

#[derive(Serialize, Deserialize, Clone, Copy)]
struct OcrUsage {
    day: u64,
    count: u32,
}

fn current_day() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}

fn read_usage(app: &AppHandle) -> OcrUsage {
    let today = current_day();
    let stored = app
        .store("store.json")
        .ok()
        .and_then(|store| store.get(USAGE_KEY))
        .and_then(|v| serde_json::from_value::<OcrUsage>(v).ok());
    match stored {
        Some(usage) if usage.day == today => usage,
        _ => OcrUsage { day: today, count: 0 },
    }
}

fn write_usage(app: &AppHandle, usage: OcrUsage) {
    if let Ok(store) = app.store("store.json") {
        store.set(USAGE_KEY, serde_json::json!(usage));
        let _ = store.save();
    }
}

#[derive(Serialize)]
pub struct OcrQuota {
    used: u32,
    limit: u32,
}

/// Lets the frontend show "used X/N today" without consuming an attempt.
#[tauri::command]
pub fn ocr_quota(app: AppHandle) -> OcrQuota {
    let usage = read_usage(&app);
    OcrQuota {
        used: usage.count,
        limit: FREE_DAILY_LIMIT,
    }
}

#[derive(Serialize)]
pub struct OcrResult {
    text: String,
    warning: Option<String>,
    used: u32,
    limit: u32,
}

fn run_tesseract(image_path: &PathBuf, lang: Option<&str>) -> std::io::Result<Output> {
    let mut cmd = Command::new("tesseract");
    cmd.arg(image_path).arg("stdout");
    if let Some(lang) = lang {
        cmd.arg("-l").arg(lang);
    }
    cmd.output()
}

fn tesseract_missing_message(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "Tesseract OCR não foi encontrado neste computador. Instale em \
         https://github.com/UB-Mannheim/tesseract/wiki e garanta que \"tesseract\" \
         esteja no PATH do sistema."
            .to_string()
    } else {
        format!("Falha ao executar o Tesseract: {e}")
    }
}

/// Runs local Tesseract OCR against an uploaded image's raw bytes (received
/// straight from the frontend's file picker/drag-drop, not a path the
/// frontend has no business knowing about) and returns the extracted text.
/// Gated by a local daily-use counter (see `FREE_DAILY_LIMIT`), consumed
/// only on a successful extraction so a failed attempt (e.g. Tesseract not
/// installed) doesn't burn the user's free use.
#[tauri::command]
pub async fn extract_text_from_image(
    app: AppHandle,
    bytes: Vec<u8>,
    file_name: String,
) -> Result<OcrResult, String> {
    let usage = read_usage(&app);
    if usage.count >= FREE_DAILY_LIMIT {
        return Err(format!(
            "Limite gratuito de {FREE_DAILY_LIMIT}x por dia atingido. Disponível novamente amanhã."
        ));
    }

    let ext = file_name
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 5 && *e != file_name)
        .unwrap_or("png");
    let temp_path = std::env::temp_dir().join(format!("toolbox-ocr-{}.{ext}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, &bytes).map_err(|e| format!("Falha ao salvar imagem temporária: {e}"))?;

    // Tries Portuguese + English first; if the "por" language pack isn't
    // installed, Tesseract exits non-zero complaining about it, so this
    // falls back to the (always-present) default and just warns instead of
    // failing the whole request over a missing optional language pack.
    let outcome = match run_tesseract(&temp_path, Some("por+eng")) {
        Ok(out) if out.status.success() => Ok((out, None)),
        Ok(_) => match run_tesseract(&temp_path, None) {
            Ok(out) if out.status.success() => Ok((
                out,
                Some(
                    "Pacote de idioma \"por\" do Tesseract não encontrado; usado o \
                     padrão (inglês). Instale o pacote \"por\" para melhor precisão \
                     em português."
                        .to_string(),
                ),
            )),
            Ok(out) => Err(format!(
                "Tesseract falhou: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )),
            Err(e) => Err(tesseract_missing_message(&e)),
        },
        Err(e) => Err(tesseract_missing_message(&e)),
    };

    let _ = fs::remove_file(&temp_path);
    let (output, warning) = outcome?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let next_usage = OcrUsage {
        day: usage.day,
        count: usage.count + 1,
    };
    write_usage(&app, next_usage);

    Ok(OcrResult {
        text,
        warning,
        used: next_usage.count,
        limit: FREE_DAILY_LIMIT,
    })
}
