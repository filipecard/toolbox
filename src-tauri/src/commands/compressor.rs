use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Local-only placeholder for the real (server-enforced) paywall — same
/// approach as the OCR tool's daily counter (see commands/ocr.rs).
/// Trivially bypassable, fine for now; genuine enforcement needs the online
/// licensing backend described in the monetization plan. The actual image
/// encoding happens client-side (Canvas API, see imageProcessing.ts) — this
/// module's only job is gating how many files run through it per day.
const FREE_DAILY_LIMIT: u32 = 10;
const USAGE_KEY: &str = "compressorUsage";

#[derive(Serialize, Deserialize, Clone, Copy)]
struct CompressorUsage {
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

fn read_usage(app: &AppHandle) -> CompressorUsage {
    let today = current_day();
    let stored = app
        .store("store.json")
        .ok()
        .and_then(|store| store.get(USAGE_KEY))
        .and_then(|v| serde_json::from_value::<CompressorUsage>(v).ok());
    match stored {
        Some(usage) if usage.day == today => usage,
        _ => CompressorUsage { day: today, count: 0 },
    }
}

fn write_usage(app: &AppHandle, usage: CompressorUsage) {
    if let Ok(store) = app.store("store.json") {
        store.set(USAGE_KEY, serde_json::json!(usage));
        let _ = store.save();
    }
}

#[derive(Serialize)]
pub struct CompressorQuota {
    used: u32,
    limit: u32,
}

/// Lets the frontend show "used X/N today" without consuming an attempt.
#[tauri::command]
pub fn compressor_quota(app: AppHandle) -> CompressorQuota {
    let usage = read_usage(&app);
    CompressorQuota {
        used: usage.count,
        limit: FREE_DAILY_LIMIT,
    }
}

/// Consumes one of today's free attempts — called once per file right
/// before the frontend processes it, so a batch that hits the limit
/// partway through stops there instead of over-counting.
#[tauri::command]
pub fn consume_compressor_use(app: AppHandle) -> Result<CompressorQuota, String> {
    let usage = read_usage(&app);
    if usage.count >= FREE_DAILY_LIMIT {
        return Err(format!(
            "Limite gratuito de {FREE_DAILY_LIMIT} arquivos por dia atingido. Disponível novamente amanhã."
        ));
    }
    let next = CompressorUsage {
        day: usage.day,
        count: usage.count + 1,
    };
    write_usage(&app, next);
    Ok(CompressorQuota {
        used: next.count,
        limit: FREE_DAILY_LIMIT,
    })
}
