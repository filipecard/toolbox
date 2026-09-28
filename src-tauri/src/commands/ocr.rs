use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use tauri::ipc::Request;
use tauri::AppHandle;

use crate::commands::raw_upload::{header, raw_body, safe_extension};
use crate::plans::{self, Feature, Quota};

#[derive(Serialize)]
pub struct OcrResult {
    text: String,
    warning: Option<String>,
    quota: Quota,
}

/// The engine downloaded as a dependency (see account/dependencies.rs)
/// when present, else a system-wide install on the PATH.
fn tesseract_command(app: &AppHandle) -> Command {
    let exe = if cfg!(windows) { "tesseract.exe" } else { "tesseract" };
    match crate::account::dependencies::find_file(app, "tesseract", exe) {
        Some(path) => {
            let mut cmd = Command::new(&path);
            if let Some(tessdata) = path.parent().map(|d| d.join("tessdata")).filter(|d| d.is_dir()) {
                cmd.env("TESSDATA_PREFIX", tessdata);
            }
            cmd
        }
        None => Command::new("tesseract"),
    }
}

fn run_tesseract(app: &AppHandle, image_path: &PathBuf, lang: Option<&str>) -> std::io::Result<Output> {
    let mut cmd = tesseract_command(app);
    cmd.arg(image_path).arg("stdout");
    if let Some(lang) = lang {
        cmd.arg("-l").arg(lang);
    }
    cmd.output()
}

fn tesseract_missing_message(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "O motor de leitura de texto (Tesseract) ainda não foi baixado. Use o botão \
         \"Baixar Tesseract\" logo abaixo."
            .to_string()
    } else {
        format!("Falha ao executar o Tesseract: {e}")
    }
}

/// Runs local Tesseract OCR against an uploaded image's raw bytes (received
/// straight from the frontend's file picker/drag-drop, not a path the
/// frontend has no business knowing about) and returns the extracted text.
/// Gated by the plan's daily-use counter (see plans.rs), consumed
/// only on a successful extraction so a failed attempt (e.g. Tesseract not
/// installed) doesn't burn the user's free use.
#[tauri::command]
pub async fn extract_text_from_image(app: AppHandle, request: Request<'_>) -> Result<OcrResult, String> {
    let bytes = raw_body(&request)?;
    let ext = safe_extension(header(&request, "x-file-name").as_deref(), "png");
    plans::check_daily(&app, Feature::OcrDaily)?;

    let temp_path = std::env::temp_dir().join(format!("toolbox-ocr-{}.{ext}", uuid::Uuid::new_v4()));
    fs::write(&temp_path, &bytes).map_err(|e| format!("Falha ao salvar imagem temporária: {e}"))?;

    // Tries Portuguese + English first; if the "por" language pack isn't
    // installed, Tesseract exits non-zero complaining about it, so this
    // falls back to the (always-present) default and just warns instead of
    // failing the whole request over a missing optional language pack.
    let outcome = match run_tesseract(&app, &temp_path, Some("por+eng")) {
        Ok(out) if out.status.success() => Ok((out, None)),
        Ok(_) => match run_tesseract(&app, &temp_path, None) {
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

    let quota = plans::consume_daily(&app, Feature::OcrDaily)?;
    Ok(OcrResult { text, warning, quota })
}
