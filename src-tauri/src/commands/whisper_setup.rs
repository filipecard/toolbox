use futures_util::StreamExt;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::whisper_paths::{get_binary_path, get_model_path, set_binary_path, set_model_path};

// Auto-setup so non-technical users never have to compile/install
// anything or paste a file path themselves — see the manual path fields
// in transcribe.rs for the advanced/fallback path, and
// toolbox_new_tool_pattern memory for why this exists (audio transcription
// needs a local model; there's no free cloud API for it).
//
// Binaries come from whisper.cpp's own GitHub releases (verified: recent
// releases publish a prebuilt Windows x64 CPU build,
// "whisper-bin-x64.zip", containing whisper-cli.exe/main.exe + the DLLs it
// needs side by side). The release *tag* changes with every build, so this
// queries the releases list at run time instead of hardcoding one.
const RELEASES_API: &str = "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10";
const WIN_ASSET_NAME: &str = "whisper-bin-x64.zip";
// The "base" ggml model: a reasonable size/accuracy default so setup stays
// a single unattended step rather than asking the user to pick a model.
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_FILE_NAME: &str = "ggml-base.bin";
const USER_AGENT: &str = "ToolBox-desktop-app";

#[derive(Serialize, Clone)]
struct SetupProgress {
    stage: String,
    percent: Option<f64>,
}

fn emit_progress(app: &AppHandle, stage: &str, percent: Option<f64>) {
    let _ = app.emit(
        "whisper-setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            percent,
        },
    );
}

pub fn whisper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("whisper"))
}

#[derive(Serialize)]
pub struct WhisperStatus {
    ready: bool,
    binary_path: Option<String>,
    model_path: Option<String>,
}

/// Cheap, no-network check of whether a previous `setup_whisper` run (in
/// this or an earlier session) already left a usable binary + model.
#[tauri::command]
pub fn whisper_setup_status(app: AppHandle) -> WhisperStatus {
    let binary_path = get_binary_path(&app).filter(|p| PathBuf::from(p).exists());
    let model_path = get_model_path(&app).filter(|p| PathBuf::from(p).exists());
    WhisperStatus {
        ready: binary_path.is_some() && model_path.is_some(),
        binary_path,
        model_path,
    }
}

async fn download_with_progress(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    stage: &str,
) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Falha ao baixar (HTTP {}).", res.status()));
    }

    let total = res.content_length();
    let mut downloaded: u64 = 0;
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Falha ao baixar: {e}"))?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        let percent = total.map(|t| (downloaded as f64 / t as f64) * 100.0);
        emit_progress(app, stage, percent);
    }
    Ok(bytes)
}

async fn find_windows_asset_url(client: &reqwest::Client) -> Result<String, String> {
    let res = client
        .get(RELEASES_API)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar releases do whisper.cpp: {e}"))?;
    if !res.status().is_success() {
        return Err(format!(
            "Falha ao consultar releases do whisper.cpp (HTTP {}).",
            res.status()
        ));
    }

    let releases: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Resposta inválida do GitHub: {e}"))?;
    let releases = releases
        .as_array()
        .ok_or_else(|| "Resposta inválida do GitHub.".to_string())?;

    for release in releases {
        let Some(assets) = release.get("assets").and_then(|a| a.as_array()) else {
            continue;
        };
        for asset in assets {
            if asset.get("name").and_then(|n| n.as_str()) == Some(WIN_ASSET_NAME) {
                if let Some(url) = asset.get("browser_download_url").and_then(|u| u.as_str()) {
                    return Ok(url.to_string());
                }
            }
        }
    }

    Err(
        "Não encontrei um binário do whisper.cpp para Windows nos releases recentes do projeto."
            .to_string(),
    )
}

/// Extracts every entry manually (rather than relying on a possibly
/// version-specific `ZipArchive::extract` convenience method) using
/// `enclosed_name()`, the zip crate's long-standing safe-path accessor
/// that also guards against zip-slip path traversal.
fn extract_zip(bytes: &[u8], dest: &PathBuf) -> Result<(), String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Falha ao abrir o zip: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Falha ao ler entrada do zip: {e}"))?;
        let Some(relative_path) = file.enclosed_name() else {
            continue;
        };
        let out_path = dest.join(relative_path);

        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Falha ao criar pasta: {e}"))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Falha ao criar pasta: {e}"))?;
        }
        let mut out_file =
            fs::File::create(&out_path).map_err(|e| format!("Falha ao criar arquivo: {e}"))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|e| format!("Falha ao extrair arquivo: {e}"))?;
    }
    Ok(())
}

fn find_whisper_cli(bin_dir: &PathBuf) -> Option<PathBuf> {
    for name in ["whisper-cli.exe", "main.exe"] {
        let candidate = bin_dir.join("Release").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Downloads (if not already present) whisper.cpp's Windows binary and the
/// default ggml model, storing both paths in store.json — the one-click
/// "just works" alternative to installing whisper.cpp and pasting a model
/// path by hand. Idempotent: re-running it after a previous success is a
/// no-op (both `WhisperStatus` fields already resolve), so a user can
/// safely hit the setup button again if something looked wrong.
#[tauri::command]
pub async fn setup_whisper(app: AppHandle) -> Result<WhisperStatus, String> {
    if std::env::consts::OS != "windows" {
        return Err(
            "A configuração automática só está disponível no Windows por enquanto. Use as \
             opções avançadas para informar o caminho de uma instalação manual do whisper.cpp."
                .to_string(),
        );
    }

    let client = reqwest::Client::new();
    let dir = whisper_dir(&app)?;
    let bin_dir = dir.join("bin");
    let models_dir = dir.join("models");
    fs::create_dir_all(&bin_dir).map_err(|e| format!("Falha ao criar pasta: {e}"))?;
    fs::create_dir_all(&models_dir).map_err(|e| format!("Falha ao criar pasta: {e}"))?;

    emit_progress(&app, "checking", None);
    let existing_binary = get_binary_path(&app).filter(|p| PathBuf::from(p).exists());
    let existing_model = get_model_path(&app).filter(|p| PathBuf::from(p).exists());

    let binary_path = match existing_binary {
        Some(p) => p,
        None => {
            emit_progress(&app, "finding_release", None);
            let asset_url = find_windows_asset_url(&client).await?;
            emit_progress(&app, "downloading_binary", Some(0.0));
            let zip_bytes = download_with_progress(&app, &client, &asset_url, "downloading_binary").await?;
            emit_progress(&app, "extracting", None);
            extract_zip(&zip_bytes, &bin_dir)?;
            let exe = find_whisper_cli(&bin_dir).ok_or_else(|| {
                "O download terminou, mas não encontrei whisper-cli.exe depois de extrair."
                    .to_string()
            })?;
            let exe_str = exe.to_string_lossy().to_string();
            set_binary_path(&app, &exe_str)?;
            exe_str
        }
    };

    let model_path = match existing_model {
        Some(p) => p,
        None => {
            emit_progress(&app, "downloading_model", Some(0.0));
            let model_bytes = download_with_progress(&app, &client, MODEL_URL, "downloading_model").await?;
            let model_file = models_dir.join(MODEL_FILE_NAME);
            fs::write(&model_file, &model_bytes).map_err(|e| format!("Falha ao salvar modelo: {e}"))?;
            let model_str = model_file.to_string_lossy().to_string();
            set_model_path(&app, &model_str)?;
            model_str
        }
    };

    emit_progress(&app, "done", Some(100.0));
    Ok(WhisperStatus {
        ready: true,
        binary_path: Some(binary_path),
        model_path: Some(model_path),
    })
}
