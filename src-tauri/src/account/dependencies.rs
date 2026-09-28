//! Per-tool dependency packages (e.g. the Tesseract OCR engine), published
//! by the admin on the website and downloaded only by the tools that need
//! them — instead of shipping everything in the installer.
//!
//! Each package is a .zip; it's checked against the SHA-256 the server
//! published before being extracted to <app data>/deps/<id>/.

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use super::api;

const PROGRESS_EVENT: &str = "dependency-progress";
const VERSION_FILE: &str = ".toolbox-version";
/// Dependency ids that exist (see packages/shared/src/tools.ts).
const KNOWN: &[&str] = &["tesseract", "whisper"];

pub fn deps_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    if !KNOWN.contains(&id) {
        return None;
    }
    app.path().app_data_dir().ok().map(|d| d.join("deps").join(id))
}

/// Finds `file_name` in the dependency folder or one level below (zips
/// often wrap everything in a top-level folder).
pub fn find_file(app: &AppHandle, id: &str, file_name: &str) -> Option<PathBuf> {
    let dir = deps_dir(app, id)?;
    let direct = dir.join(file_name);
    if direct.is_file() {
        return Some(direct);
    }
    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path().join(file_name))
        .find(|p| p.is_file())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    installed: bool,
    version: Option<String>,
}

#[tauri::command]
pub fn dependency_status(app: AppHandle, id: String) -> Result<DependencyStatus, String> {
    let dir = deps_dir(&app, &id).ok_or("Dependência desconhecida.")?;
    let version = std::fs::read_to_string(dir.join(VERSION_FILE)).ok().map(|v| v.trim().to_string());
    Ok(DependencyStatus {
        installed: version.is_some(),
        version,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    stage: &'a str,
    downloaded: u64,
    total: u64,
}

/// Extracts, refusing entries that would land outside `dest` (zip-slip).
fn extract(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "Pacote corrompido.".to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            return Err("Pacote com caminho inválido.".into());
        };
        let out = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut target = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn install_dependency(app: AppHandle, id: String) -> Result<DependencyStatus, String> {
    let dir = deps_dir(&app, &id).ok_or("Dependência desconhecida.")?;
    let token = super::access_token(&app).await.map_err(|e| e.message())?;
    let downloads: api::DownloadsResponse = api::get("/downloads", &token).await.map_err(|e| e.message())?;
    let release = downloads
        .dependencies
        .into_iter()
        .find(|r| r.target == id)
        .ok_or("Esse pacote ainda não está disponível para download. Tente mais tarde.")?;
    let link: api::DownloadLink = api::post(&format!("/downloads/{}/link", release.id), &serde_json::json!({}), Some(&token))
        .await
        .map_err(|e| e.message())?;

    // Download to a temp file, hashing as it streams.
    let tmp = std::env::temp_dir().join(format!("toolbox-dep-{id}-{}.zip", uuid::Uuid::new_v4()));
    let result: Result<(), String> = async {
        let res = api::get_raw(&link.url).await.map_err(|e| e.message())?;
        let total = res.content_length().unwrap_or(release.size);
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0u64;
        let mut last_emit = 0u64;
        let mut stream = res.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "A conexão caiu durante o download.".to_string())?;
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            if downloaded - last_emit > 512 * 1024 || downloaded == total {
                last_emit = downloaded;
                let _ = app.emit(PROGRESS_EVENT, Progress { id: &id, stage: "downloading", downloaded, total });
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if digest != release.sha256 {
            return Err("O arquivo baixado não confere com o original (verificação de integridade falhou).".into());
        }

        let _ = app.emit(PROGRESS_EVENT, Progress { id: &id, stage: "extracting", downloaded, total });
        // Extract next to the final folder, then swap: a failed extraction
        // never leaves a half-installed dependency behind.
        let staging = dir.with_extension("staging");
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        extract(&tmp, &staging)?;
        std::fs::write(staging.join(VERSION_FILE), &release.version).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::rename(&staging, &dir).map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    let _ = std::fs::remove_file(&tmp);
    result?;
    dependency_status(app, id)
}
