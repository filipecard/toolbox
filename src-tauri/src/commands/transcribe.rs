use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::commands::whisper_paths::{get_binary_path, get_model_path, set_model_path};

/// Local-only placeholder for the real (server-enforced) paywall — same
/// approach as the OCR tool's daily counter (see commands/ocr.rs).
const FREE_DAILY_LIMIT: u32 = 5;
/// Generous enough for a several-minute WAV recording without needing to
/// actually decode/measure audio duration for the free-tier size cap.
const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
const USAGE_KEY: &str = "transcribeUsage";

#[derive(Serialize, Deserialize, Clone, Copy)]
struct TranscribeUsage {
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

fn read_usage(app: &AppHandle) -> TranscribeUsage {
    let today = current_day();
    let stored = app
        .store("store.json")
        .ok()
        .and_then(|store| store.get(USAGE_KEY))
        .and_then(|v| serde_json::from_value::<TranscribeUsage>(v).ok());
    match stored {
        Some(usage) if usage.day == today => usage,
        _ => TranscribeUsage { day: today, count: 0 },
    }
}

fn write_usage(app: &AppHandle, usage: TranscribeUsage) {
    if let Ok(store) = app.store("store.json") {
        store.set(USAGE_KEY, serde_json::json!(usage));
        let _ = store.save();
    }
}

#[derive(Serialize)]
pub struct TranscribeQuota {
    used: u32,
    limit: u32,
}

/// Lets the frontend show "used X/N today" without consuming an attempt.
#[tauri::command]
pub fn transcribe_quota(app: AppHandle) -> TranscribeQuota {
    let usage = read_usage(&app);
    TranscribeQuota {
        used: usage.count,
        limit: FREE_DAILY_LIMIT,
    }
}

/// Advanced/manual fallback for a user who already has their own
/// whisper.cpp + model install (or is on a platform `setup_whisper` in
/// whisper_setup.rs doesn't auto-provision yet) — most users go through
/// the one-click auto-setup instead and never touch this.
#[tauri::command]
pub fn get_whisper_model_path(app: AppHandle) -> Option<String> {
    get_model_path(&app)
}

#[tauri::command]
pub fn set_whisper_model_path(app: AppHandle, path: String) -> Result<(), String> {
    set_model_path(&app, &path)
}

fn whisper_missing_message(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "whisper.cpp não foi encontrado. Tente o botão de configuração automática, ou — nas \
         opções avançadas — informe o caminho de uma instalação manual \
         (https://github.com/ggml-org/whisper.cpp)."
            .to_string()
    } else {
        format!("Falha ao executar o whisper.cpp: {e}")
    }
}

fn try_run(binary: &str, model_path: &str, wav_path: &PathBuf, lang: &str) -> std::io::Result<Output> {
    Command::new(binary)
        .arg("-m")
        .arg(model_path)
        .arg("-f")
        .arg(wav_path)
        .arg("-l")
        .arg(lang)
        .arg("-nt")
        .output()
}

/// Binaries to try, in order: the auto-downloaded/manually-configured path
/// first (if set), then bare command names relying on the system PATH —
/// covers a user who installed whisper.cpp themselves before this
/// auto-setup feature existed, or who's on a platform auto-setup doesn't
/// cover yet.
fn candidate_binaries(app: &AppHandle) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(path) = get_binary_path(app) {
        candidates.push(path);
    }
    candidates.push("whisper-cli".to_string());
    candidates.push("main".to_string());
    candidates
}

#[derive(Serialize)]
pub struct TranscribeResult {
    text: String,
    used: u32,
    limit: u32,
}

/// Runs local whisper.cpp against an uploaded WAV file's raw bytes (from
/// the frontend's file picker/drag-drop, not a path the frontend has no
/// business knowing about — same reasoning as OCR's `extract_text_from_image`).
/// Gated by a local daily-use counter, consumed only on a successful
/// transcription so a failed attempt doesn't burn the user's free use.
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    bytes: Vec<u8>,
    file_name: String,
    lang: String,
) -> Result<TranscribeResult, String> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!(
            "Arquivo maior que o limite gratuito de {} MB.",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }

    let usage = read_usage(&app);
    if usage.count >= FREE_DAILY_LIMIT {
        return Err(format!(
            "Limite gratuito de {FREE_DAILY_LIMIT}x por dia atingido. Disponível novamente amanhã."
        ));
    }

    let model_path = get_model_path(&app)
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| {
            "Nenhum modelo Whisper configurado ainda. Use o botão de configuração automática."
                .to_string()
        })?;
    if !PathBuf::from(&model_path).exists() {
        return Err(format!("Arquivo de modelo não encontrado: {model_path}"));
    }

    let ext = file_name
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 5 && *e != file_name)
        .unwrap_or("wav");
    let temp_path =
        std::env::temp_dir().join(format!("toolbox-audio-{}.{ext}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, &bytes).map_err(|e| format!("Falha ao salvar áudio temporário: {e}"))?;

    let candidates = candidate_binaries(&app);
    let mut outcome: Option<Result<Output, String>> = None;
    let mut last_not_found: Option<std::io::Error> = None;
    for binary in &candidates {
        match try_run(binary, &model_path, &temp_path, &lang) {
            Ok(out) if out.status.success() => {
                outcome = Some(Ok(out));
                break;
            }
            Ok(out) => {
                outcome = Some(Err(format!(
                    "whisper.cpp falhou: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                )));
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                last_not_found = Some(e);
                continue;
            }
            Err(e) => {
                outcome = Some(Err(format!("Falha ao executar o whisper.cpp: {e}")));
                break;
            }
        }
    }
    let outcome = outcome.unwrap_or_else(|| {
        Err(whisper_missing_message(
            &last_not_found.unwrap_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "no binary candidates")
            }),
        ))
    });

    let _ = fs::remove_file(&temp_path);
    let output = outcome?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let next_usage = TranscribeUsage {
        day: usage.day,
        count: usage.count + 1,
    };
    write_usage(&app, next_usage);

    Ok(TranscribeResult {
        text,
        used: next_usage.count,
        limit: FREE_DAILY_LIMIT,
    })
}
