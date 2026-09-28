use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use tauri::ipc::Request;
use tauri::AppHandle;

use crate::commands::raw_upload::{header, raw_body, safe_extension};
use crate::commands::whisper_paths::{get_binary_path, get_model_path, set_model_path};
use crate::plans::{self, Feature, Quota};

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
    quota: Quota,
}

/// Runs local whisper.cpp against an uploaded WAV file's raw bytes (from
/// the frontend's file picker/drag-drop, not a path the frontend has no
/// business knowing about — same reasoning as OCR's `extract_text_from_image`).
/// Gated by the plan's daily-use counter and file-size cap, consumed only on a successful
/// transcription so a failed attempt doesn't burn the user's free use.
#[tauri::command]
pub async fn transcribe_audio(app: AppHandle, request: Request<'_>) -> Result<TranscribeResult, String> {
    let bytes = raw_body(&request)?;
    let ext = safe_extension(header(&request, "x-file-name").as_deref(), "wav");
    // whisper's -l flag: a short language code ("pt", "en", "auto").
    let lang = header(&request, "x-lang")
        .filter(|l| !l.is_empty() && l.len() <= 8 && l.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "auto".to_string());
    if let Some(max_mb) = plans::limit(&app, Feature::TranscribeFileMb) {
        if bytes.len() > max_mb as usize * 1024 * 1024 {
            return Err(plans::limit_message(&app, Feature::TranscribeFileMb));
        }
    }
    plans::check_daily(&app, Feature::TranscribeDaily)?;

    let model_path = get_model_path(&app)
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| {
            "Nenhum modelo Whisper configurado ainda. Use o botão de configuração automática."
                .to_string()
        })?;
    if !PathBuf::from(&model_path).exists() {
        return Err(format!("Arquivo de modelo não encontrado: {model_path}"));
    }

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

    let quota = plans::consume_daily(&app, Feature::TranscribeDaily)?;
    Ok(TranscribeResult { text, quota })
}
