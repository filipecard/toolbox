//! Paid-plan tiers and every usage limit they control — the single source
//! of truth for "how much of X can this user do", read by each tool's
//! commands and mirrored to the frontend through `plan_status`.
//!
//! Model (see the monetization plan): each paid tool is sold on its own
//! ladder — Grátis → Básico → Prata → Gold, each loosening that tool's
//! limits for a higher price — and a separate Diamante plan unlocks every
//! tool with no limits at all. Fully-free tools (notes, translator,
//! converter, devtools) have no entries here.
//!
//! The plan itself belongs to the user's online account: it arrives as a
//! server-signed token, verified in account/ — see `AccountState::entitlements`.
//! There is deliberately no command for the app's own UI to change it.
//! plan.json only holds the daily usage counters (and the account cache).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;
use crate::storage::PLAN_STORE;

const USAGE_KEY_PREFIX: &str = "usage.";
pub const PLAN_CHANGED_EVENT: &str = "plan-changed";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    #[default]
    Free,
    Basic,
    Silver,
    Gold,
}

impl Tier {
    fn index(self) -> usize {
        self as usize
    }

    fn label(self) -> &'static str {
        match self {
            Tier::Free => "Grátis",
            Tier::Basic => "Básico",
            Tier::Silver => "Prata",
            Tier::Gold => "Gold",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Entitlements {
    /// Diamante: every tool, no limits — overrides the per-tool tiers.
    #[serde(default)]
    pub diamond: bool,
    /// Per-tool tier, keyed by toolId. Missing means Grátis.
    #[serde(default)]
    pub tools: HashMap<String, Tier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    OcrDaily,
    CompressorDaily,
    TranscribeDaily,
    TranscribeFileMb,
    ClipboardHistory,
    ClipboardPinned,
    FileSearchResults,
    CalcVariables,
    HarmoniesDaily,
    RemindersActive,
}

struct FeatureSpec {
    id: &'static str,
    tool: &'static str,
    label: &'static str,
    /// Counted per day (resets at midnight) vs. a standing cap.
    daily: bool,
    /// Limits for Grátis, Básico, Prata, Gold. Diamante is always unlimited.
    limits: [u32; 4],
}

impl Feature {
    pub const ALL: [Feature; 10] = [
        Feature::OcrDaily,
        Feature::CompressorDaily,
        Feature::TranscribeDaily,
        Feature::TranscribeFileMb,
        Feature::ClipboardHistory,
        Feature::ClipboardPinned,
        Feature::FileSearchResults,
        Feature::CalcVariables,
        Feature::HarmoniesDaily,
        Feature::RemindersActive,
    ];

    fn spec(self) -> FeatureSpec {
        let (id, tool, label, daily, limits) = match self {
            Feature::OcrDaily => ("ocrDaily", "ocr", "Imagens lidas por dia", true, [2, 20, 60, 200]),
            Feature::CompressorDaily => {
                ("compressorDaily", "compressor", "Arquivos comprimidos por dia", true, [5, 50, 200, 1000])
            }
            Feature::TranscribeDaily => {
                ("transcribeDaily", "transcribe", "Transcrições por dia", true, [2, 15, 50, 150])
            }
            Feature::TranscribeFileMb => {
                ("transcribeFileMb", "transcribe", "Tamanho máximo do áudio (MB)", false, [10, 25, 50, 100])
            }
            Feature::ClipboardHistory => {
                ("clipboardHistory", "clipboard", "Itens no histórico", false, [5, 50, 200, 1000])
            }
            Feature::ClipboardPinned => {
                ("clipboardPinned", "clipboard", "Fixados e textos prontos", false, [3, 20, 100, 500])
            }
            Feature::FileSearchResults => {
                ("fileSearchResults", "file-search", "Resultados por busca", false, [100, 500, 2000, 10000])
            }
            Feature::CalcVariables => ("calcVariables", "calculator", "Variáveis", false, [3, 10, 25, 50]),
            Feature::HarmoniesDaily => {
                ("harmoniesDaily", "color-picker", "Paletas harmônicas por dia", true, [3, 30, 100, 300])
            }
            Feature::RemindersActive => {
                ("remindersActive", "reminders", "Lembretes agendados ao mesmo tempo", false, [5, 20, 50, 150])
            }
        };
        FeatureSpec { id, tool, label, daily, limits }
    }

    pub fn from_id(id: &str) -> Option<Feature> {
        Feature::ALL.into_iter().find(|f| f.spec().id == id)
    }
}

/// Serializes read-modify-write of usage counters, so two quick calls (e.g.
/// a compressor batch) can't both read the same count and lose one.
static USAGE_LOCK: Mutex<()> = Mutex::new(());

pub fn entitlements(app: &AppHandle) -> Entitlements {
    app.state::<AppState>().account.entitlements()
}

/// Called whenever the account's plan may have changed: standing caps that
/// hold stored data apply right away (not just on the next insert), and
/// open windows refresh their limits.
pub fn apply_plan_change(app: &AppHandle) {
    crate::commands::clipboard::enforce_plan_limit(app);
    let _ = app.emit(PLAN_CHANGED_EVENT, ());
}

fn plan_label(ent: &Entitlements, tool: &str) -> &'static str {
    if ent.diamond {
        "Diamante"
    } else {
        ent.tools.get(tool).copied().unwrap_or_default().label()
    }
}

fn limit_for(ent: &Entitlements, feature: Feature) -> Option<u32> {
    if ent.diamond {
        return None;
    }
    let spec = feature.spec();
    let tier = ent.tools.get(spec.tool).copied().unwrap_or_default();
    Some(spec.limits[tier.index()])
}

/// The current limit for `feature`, or `None` when unlimited.
pub fn limit(app: &AppHandle, feature: Feature) -> Option<u32> {
    limit_for(&entitlements(app), feature)
}

/// "Limite do plano Grátis (5 itens) atingido..." — shared wording so every
/// tool explains a cap the same way.
pub fn limit_message(app: &AppHandle, feature: Feature) -> String {
    let ent = entitlements(app);
    let spec = feature.spec();
    let plan = plan_label(&ent, spec.tool);
    let amount = limit_for(&ent, feature).unwrap_or(0);
    let tail = if spec.daily {
        "Disponível novamente amanhã, ou faça upgrade do plano."
    } else {
        "Faça upgrade do plano para aumentar esse limite."
    };
    format!("Limite do plano {plan} atingido ({}: {amount}). {tail}", spec.label.to_lowercase())
}

// --- Daily counters ---

#[derive(Serialize, Deserialize, Clone, Copy)]
struct DailyUsage {
    day: u64,
    count: u32,
}

/// Today as a day number in the user's local time zone, so daily limits
/// reset at local midnight (UTC day numbers flipped at 21:00 in Brasília).
fn current_day() -> u64 {
    local_day_number(chrono::Local::now().date_naive())
}

fn local_day_number(date: chrono::NaiveDate) -> u64 {
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).expect("valid date");
    date.signed_duration_since(epoch).num_days().max(0) as u64
}

fn read_usage(app: &AppHandle, feature: Feature) -> DailyUsage {
    let today = current_day();
    let key = format!("{USAGE_KEY_PREFIX}{}", feature.spec().id);
    let stored = app
        .store(PLAN_STORE)
        .ok()
        .and_then(|store| store.get(&key))
        .and_then(|v| serde_json::from_value::<DailyUsage>(v).ok());
    match stored {
        Some(usage) if usage.day == today => usage,
        _ => DailyUsage { day: today, count: 0 },
    }
}

fn write_usage(app: &AppHandle, feature: Feature, usage: DailyUsage) {
    if let Ok(store) = app.store(PLAN_STORE) {
        store.set(format!("{USAGE_KEY_PREFIX}{}", feature.spec().id), serde_json::json!(usage));
        let _ = store.save();
    }
}

#[derive(Serialize, Clone)]
pub struct Quota {
    pub used: u32,
    /// `None` = unlimited.
    pub limit: Option<u32>,
    /// Display name of the plan that set this limit.
    pub plan: String,
}

pub fn daily_quota(app: &AppHandle, feature: Feature) -> Quota {
    let ent = entitlements(app);
    Quota {
        used: read_usage(app, feature).count,
        limit: limit_for(&ent, feature),
        plan: plan_label(&ent, feature.spec().tool).to_string(),
    }
}

/// Errors (without consuming anything) when today's allowance is used up.
/// For work that can still fail after this check (OCR, transcription), call
/// `consume_daily` only once it succeeded, so failures don't burn a use.
pub fn check_daily(app: &AppHandle, feature: Feature) -> Result<(), String> {
    let quota = daily_quota(app, feature);
    match quota.limit {
        Some(limit) if quota.used >= limit => Err(limit_message(app, feature)),
        _ => Ok(()),
    }
}

/// Atomically checks and consumes one use.
pub fn consume_daily(app: &AppHandle, feature: Feature) -> Result<Quota, String> {
    let _guard = USAGE_LOCK.lock().unwrap();
    check_daily(app, feature)?;
    let usage = read_usage(app, feature);
    let next = DailyUsage {
        day: usage.day,
        count: usage.count + 1,
    };
    write_usage(app, feature, next);
    Ok(daily_quota(app, feature))
}

// --- Commands ---

#[derive(Serialize)]
pub struct PlanStatus {
    diamond: bool,
    tools: HashMap<String, Tier>,
    /// Current limit per feature id (`null` = unlimited).
    limits: HashMap<&'static str, Option<u32>>,
}

#[tauri::command]
pub fn plan_status(app: AppHandle) -> PlanStatus {
    let ent = entitlements(&app);
    let limits = Feature::ALL
        .into_iter()
        .map(|f| (f.spec().id, limit_for(&ent, f)))
        .collect();
    PlanStatus {
        diamond: ent.diamond,
        tools: ent.tools,
        limits,
    }
}

#[tauri::command]
pub fn feature_quota(app: AppHandle, feature: String) -> Result<Quota, String> {
    let feature = Feature::from_id(&feature).ok_or_else(|| format!("Recurso desconhecido: {feature}"))?;
    Ok(daily_quota(&app, feature))
}

/// Consumes one daily use of a feature whose work runs in the frontend
/// (compressor, harmony palettes).
#[tauri::command]
pub fn consume_feature_use(app: AppHandle, feature: String) -> Result<Quota, String> {
    let feature = Feature::from_id(&feature).ok_or_else(|| format!("Recurso desconhecido: {feature}"))?;
    consume_daily(&app, feature)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tier_loosens_every_limit() {
        for f in Feature::ALL {
            let l = f.spec().limits;
            assert!(l.windows(2).all(|w| w[0] < w[1]), "{} limits must grow per tier: {l:?}", f.spec().id);
        }
    }

    #[test]
    fn free_daily_samples_stay_between_1_and_5() {
        for f in Feature::ALL.into_iter().filter(|f| f.spec().daily) {
            let free = f.spec().limits[0];
            assert!((1..=5).contains(&free), "{} free daily limit is {free}", f.spec().id);
        }
    }

    #[test]
    fn feature_ids_round_trip() {
        for f in Feature::ALL {
            assert_eq!(Feature::from_id(f.spec().id), Some(f));
        }
    }

    #[test]
    fn diamond_is_unlimited_and_overrides_tiers() {
        let mut ent = Entitlements::default();
        ent.tools.insert("ocr".into(), Tier::Silver);
        assert_eq!(limit_for(&ent, Feature::OcrDaily), Some(60));
        assert_eq!(limit_for(&ent, Feature::CompressorDaily), Some(5)); // other tool stays free
        ent.diamond = true;
        assert!(Feature::ALL.into_iter().all(|f| limit_for(&ent, f).is_none()));
        assert_eq!(plan_label(&ent, "ocr"), "Diamante");
    }

    #[test]
    fn day_numbers_follow_the_calendar_date() {
        let d = |y, m, day| chrono::NaiveDate::from_ymd_opt(y, m, day).unwrap();
        assert_eq!(local_day_number(d(1970, 1, 1)), 0);
        assert_eq!(local_day_number(d(2026, 9, 24)) - local_day_number(d(2026, 9, 23)), 1);
    }

    #[test]
    fn tiers_serialize_as_lowercase_ids() {
        assert_eq!(serde_json::to_string(&Tier::Silver).unwrap(), "\"silver\"");
        let parsed: Entitlements = serde_json::from_str(r#"{"tools":{"ocr":"gold"}}"#).unwrap();
        assert_eq!(parsed.tools["ocr"], Tier::Gold);
        assert!(!parsed.diamond);
    }
}
