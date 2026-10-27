//! The user's ToolBox account on this computer.
//!
//! - Sign-in goes through the browser (device authorization flow): the app
//!   shows a code, the user confirms it on the website; the password never
//!   touches the app.
//! - The refresh token lives in the Windows Credential Manager (keyring),
//!   not in a plain file.
//! - The plan arrives as an Ed25519-signed token (see entitlement.rs) that
//!   is verified here and cached, so the app works offline for up to 7 days
//!   and editing local files can't unlock anything.
//! - Without a valid session nothing opens: no bubble, no tools, no
//!   shortcuts — only the sign-in window.

pub mod api;
pub mod dependencies;
pub mod entitlement;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use crate::plans::Entitlements;
use crate::state::AppState;
use crate::storage::{PLAN_STORE, SETTINGS_STORE};
use api::{ApiError, ApiUser};
use entitlement::{EntitlementClaims, VerifyError};

const KEYRING_SERVICE: &str = "com.filip.toolbox";
const KEYRING_USER: &str = "refresh-token";
const USER_KEY: &str = "account";
const TOKEN_KEY: &str = "entitlementToken";
const CLOCK_KEY: &str = "clockHighWater";
const TOOLS_SYNCED_KEY: &str = "toolsSyncedFor";
pub const ACCOUNT_CHANGED_EVENT: &str = "account-changed";
pub const ACCOUNT_WINDOW: &str = "account";
/// How often the plan is re-fetched while the app runs.
const REFRESH_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Clock rollback tolerance: turning the PC clock back further than this
/// (to stretch the offline window) invalidates the cached plan.
const CLOCK_SKEW_TOLERANCE_S: u64 = 24 * 60 * 60;

/// What the sign-in window and Settings show.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AccountStatus {
    /// Startup: checking the saved session.
    Loading,
    SignedOut { message: Option<String> },
    /// Waiting for the user to confirm the code in the browser.
    Pending { user_code: String, verification_uri: String },
    Active {
        user: ApiUser,
        /// Working from the cached plan (no connection right now).
        offline: bool,
        /// Epoch ms until which the cached plan remains valid.
        valid_until: u64,
        diamond: bool,
    },
    /// Signed in, but the offline allowance ran out: must reconnect.
    NeedsConnection { user: ApiUser },
    /// New terms must be accepted on the website.
    TermsRequired { user: ApiUser },
    /// Debug builds only: using the app without an account.
    DevMode,
}

struct Inner {
    status: AccountStatus,
    user: Option<ApiUser>,
    claims: Option<EntitlementClaims>,
    access: Option<(String, u64)>,
}

pub struct AccountState {
    inner: Mutex<Inner>,
    /// Bumped to cancel an in-flight sign-in poll.
    login_gen: AtomicU64,
    /// Serializes token refreshes: refresh tokens rotate on every use, so
    /// two concurrent refreshes would make the second look like a replay.
    refresh_lock: tokio::sync::Mutex<()>,
}

impl Default for AccountState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: AccountStatus::Loading,
                user: None,
                claims: None,
                access: None,
            }),
            login_gen: AtomicU64::new(0),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }
}

impl AccountState {
    /// The plan in force: the verified token's, or Grátis for everything.
    pub fn entitlements(&self) -> Entitlements {
        let inner = self.inner.lock().unwrap();
        if matches!(inner.status, AccountStatus::DevMode) || crate::integrity::debugger_attached() {
            return Entitlements::default();
        }
        match &inner.claims {
            Some(c) if c.exp > now_s() => Entitlements {
                diamond: c.diamond,
                tools: c.tools.clone(),
            },
            _ => Entitlements::default(),
        }
    }

    /// Whether the app may be used right now.
    pub fn is_active(&self) -> bool {
        matches!(
            self.inner.lock().unwrap().status,
            AccountStatus::Active { .. } | AccountStatus::DevMode
        )
    }

    pub fn status(&self) -> AccountStatus {
        self.inner.lock().unwrap().status.clone()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_s() -> u64 {
    now_ms() / 1000
}

fn account(app: &AppHandle) -> &AccountState {
    &app.state::<AppState>().inner().account
}

// --- Persistence ---

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

fn load_refresh_token() -> Option<String> {
    keyring_entry()?.get_password().ok()
}

fn save_refresh_token(token: &str) {
    if let Some(entry) = keyring_entry() {
        if let Err(e) = entry.set_password(token) {
            eprintln!("account: could not store refresh token: {e}");
        }
    }
}

fn delete_refresh_token() {
    if let Some(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}

fn store_get<T: for<'de> Deserialize<'de>>(app: &AppHandle, key: &str) -> Option<T> {
    app.store(PLAN_STORE)
        .ok()
        .and_then(|s| s.get(key))
        .and_then(|v| serde_json::from_value(v).ok())
}

fn store_set(app: &AppHandle, key: &str, value: serde_json::Value) {
    if let Ok(store) = app.store(PLAN_STORE) {
        store.set(key, value);
        let _ = store.save();
    }
}

fn store_delete(app: &AppHandle, keys: &[&str]) {
    if let Ok(store) = app.store(PLAN_STORE) {
        for key in keys {
            store.delete(*key);
        }
        let _ = store.save();
    }
}

/// Current time, unless the clock was turned back past the latest time
/// this install has seen — then "now" is that high-water mark, so rolling
/// the clock back can't revive an expired plan.
fn trusted_now_s(app: &AppHandle) -> Option<u64> {
    let now = now_s();
    let high: u64 = store_get(app, CLOCK_KEY).unwrap_or(0);
    if now + CLOCK_SKEW_TOLERANCE_S < high {
        return None;
    }
    if now > high {
        store_set(app, CLOCK_KEY, serde_json::json!(now));
    }
    Some(now.max(high))
}

fn verify_cached(app: &AppHandle, user: &ApiUser) -> Result<EntitlementClaims, VerifyError> {
    let token: String = store_get(app, TOKEN_KEY).ok_or(VerifyError::Malformed)?;
    let now = trusted_now_s(app).ok_or(VerifyError::Expired)?;
    entitlement::verify(&token, &user.id, machine_hash().as_deref(), now)
}

// --- State transitions ---

fn set_status(app: &AppHandle, status: AccountStatus) {
    let changed = {
        let mut inner = account(app).inner.lock().unwrap();
        let changed = inner.status != status;
        inner.status = status.clone();
        changed
    };
    if changed {
        let _ = app.emit(ACCOUNT_CHANGED_EVENT, status);
        crate::plans::apply_plan_change(app);
    }
}

fn active_status(user: ApiUser, claims: &EntitlementClaims, offline: bool) -> AccountStatus {
    AccountStatus::Active {
        user,
        offline,
        valid_until: claims.exp * 1000,
        diamond: claims.diamond,
    }
}

/// Forgets the session on this computer (tokens, cached plan).
fn clear_local(app: &AppHandle) {
    delete_refresh_token();
    store_delete(app, &[USER_KEY, TOKEN_KEY]);
    let mut inner = account(app).inner.lock().unwrap();
    inner.user = None;
    inner.claims = None;
    inner.access = None;
}

/// Exchanges the stored refresh token for a new pair (rotation).
async fn refresh_tokens(app: &AppHandle) -> Result<(String, ApiUser), ApiError> {
    let _guard = account(app).refresh_lock.lock().await;
    let refresh = load_refresh_token().ok_or(ApiError::Api {
        status: 401,
        code: "session_expired".into(),
        message: "Faça login para continuar.".into(),
    })?;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body<'a> {
        refresh_token: &'a str,
    }
    let res: api::TokenResponse = api::post("/auth/refresh", &Body { refresh_token: &refresh }, None).await?;
    save_refresh_token(&res.refresh_token);
    let mut inner = account(app).inner.lock().unwrap();
    inner.access = Some((res.access_token.clone(), res.access_token_expires_at));
    inner.user = Some(res.user.clone());
    Ok((res.access_token, res.user))
}

/// A valid access token, refreshing it when it's about to expire.
pub async fn access_token(app: &AppHandle) -> Result<String, ApiError> {
    let cached = account(app).inner.lock().unwrap().access.clone();
    if let Some((token, exp)) = cached {
        if exp > now_ms() + 60_000 {
            return Ok(token);
        }
    }
    Ok(refresh_tokens(app).await?.0)
}

/// Re-fetches the signed plan and updates the status. Network failures
/// keep the cached plan while it's still valid.
async fn sync(app: &AppHandle) -> Result<(), ApiError> {
    let result: Result<(ApiUser, api::EntitlementResponse, String), ApiError> = async {
        let (access, user) = refresh_tokens(app).await?;
        let ent: api::EntitlementResponse = api::get("/me/entitlement-token", &access).await?;
        Ok((user, ent, access))
    }
    .await;

    match result {
        Ok((user, ent, access)) => {
            let now = trusted_now_s(app).unwrap_or_else(now_s);
            let claims = entitlement::verify(&ent.token, &user.id, machine_hash().as_deref(), now).map_err(|e| ApiError::Api {
                status: 500,
                code: "bad_entitlement".into(),
                message: format!("O plano recebido do servidor não pôde ser verificado ({e:?})."),
            })?;
            store_set(app, TOKEN_KEY, serde_json::json!(ent.token));
            store_set(app, USER_KEY, serde_json::json!(user));
            apply_tool_selection_once(app, &user.id, &ent.tools);
            account(app).inner.lock().unwrap().claims = Some(claims.clone());
            set_status(app, active_status(user, &claims, false));
            crate::plans::sync_usage(app, &access).await;
            Ok(())
        }
        Err(e) if e.is_session_lost() => {
            clear_local(app);
            set_status(app, AccountStatus::SignedOut { message: Some(e.message()) });
            Err(e)
        }
        Err(e) if e.code() == "terms_required" => {
            let user = account(app).inner.lock().unwrap().user.clone();
            if let Some(user) = user {
                set_status(app, AccountStatus::TermsRequired { user });
            }
            Err(e)
        }
        Err(e) => {
            // Offline or server trouble: fall back to the cached plan.
            let user = account(app).inner.lock().unwrap().user.clone();
            if let Some(user) = user {
                match verify_cached(app, &user) {
                    Ok(claims) => set_status(app, active_status(user, &claims, true)),
                    Err(_) => set_status(app, AccountStatus::NeedsConnection { user }),
                }
            }
            Err(e)
        }
    }
}

/// The tools picked on the download page decide which ones are installed
/// (and show up in the quick menu) — once, on this computer's first sign-in; after that the
/// user's own choices in Settings win.
fn apply_tool_selection_once(app: &AppHandle, user_id: &str, tools: &[String]) {
    let synced = store_get::<String>(app, TOOLS_SYNCED_KEY);
    if tools.is_empty() || synced.as_deref() == Some(user_id) || synced.as_deref() == Some(TOOLS_FROM_INSTALLER) {
        return;
    }
    let Ok(store) = app.store(SETTINGS_STORE) else { return };
    if let Some(mut settings) = store.get("settings") {
        if let Some(items) = settings.get_mut("quickMenuItems").and_then(|v| v.as_array_mut()) {
            for item in items {
                let enabled = item
                    .get("toolId")
                    .and_then(|v| v.as_str())
                    .is_some_and(|id| tools.iter().any(|t| t == id));
                item["enabled"] = serde_json::json!(enabled);
                item["installed"] = serde_json::json!(enabled);
            }
            store.set("settings", settings);
            let _ = store.save();
            let _ = app.emit("settings-changed", serde_json::Value::Null);
        }
    }
    store_set(app, TOOLS_SYNCED_KEY, serde_json::json!(user_id));
}

const TOOLS_FROM_INSTALLER: &str = "installer";

/// The installer already decided which tools show up on this computer:
/// the website's selection must not override it later.
pub fn mark_tools_chosen_by_installer(app: &AppHandle) {
    store_set(app, TOOLS_SYNCED_KEY, serde_json::json!(TOOLS_FROM_INSTALLER));
}

// --- Windows ---

pub fn show_account_window(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(win) = app.get_webview_window(ACCOUNT_WINDOW) {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
            return;
        }
        let built = tauri::WebviewWindowBuilder::new(&app, ACCOUNT_WINDOW, tauri::WebviewUrl::App("index.html".into()))
            .title("ToolBox — Entrar")
            .inner_size(420.0, 540.0)
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .shadow(true)
            .center()
            .build();
        if let Err(e) = built {
            eprintln!("failed to create account window: {e}");
        }
    });
}

fn close_account_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(ACCOUNT_WINDOW) {
        let _ = win.destroy();
    }
}

/// Signed in: the account window steps aside for the bubble.
fn enter_app(app: &AppHandle) {
    close_account_window(app);
    crate::commands::windows::show_launcher(app);
}

/// Signed out: every window but the sign-in one goes away.
fn leave_app(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label != ACCOUNT_WINDOW {
            let _ = win.destroy();
        }
    }
    show_account_window(app);
}

// --- Startup ---

/// Restores the saved session. With a still-valid cached plan the bubble
/// opens immediately (and the plan refreshes in the background); otherwise
/// the sign-in window is shown.
pub fn start(app: &AppHandle) {
    let user: Option<ApiUser> = store_get(app, USER_KEY);
    let has_session = load_refresh_token().is_some();

    match (user, has_session) {
        (Some(user), true) => {
            account(app).inner.lock().unwrap().user = Some(user.clone());
            match verify_cached(app, &user) {
                Ok(claims) => {
                    account(app).inner.lock().unwrap().claims = Some(claims.clone());
                    // Offline until the background sync says otherwise.
                    set_status(app, active_status(user, &claims, true));
                    enter_app(app);
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if sync(&app).await.is_err() && !account(&app).is_active() {
                            leave_app(&app);
                        }
                    });
                }
                Err(_) => {
                    show_account_window(app);
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if sync(&app).await.is_ok() {
                            enter_app(&app);
                        }
                    });
                }
            }
        }
        _ => {
            clear_local(app);
            set_status(app, AccountStatus::SignedOut { message: None });
            show_account_window(app);
        }
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(REFRESH_EVERY).await;
            let signed_in = account(&app).inner.lock().unwrap().user.is_some();
            if signed_in {
                let was_active = account(&app).is_active();
                let _ = sync(&app).await;
                if was_active && !account(&app).is_active() {
                    leave_app(&app);
                }
            }
        }
    });
}

/// Tray icon / anything that would reveal the app: the bubble when signed
/// in, the sign-in window otherwise.
pub fn reveal(app: &AppHandle) {
    if account(app).is_active() {
        crate::commands::windows::show_launcher(app);
    } else {
        show_account_window(app);
    }
}

// --- Commands ---

#[tauri::command]
pub fn account_status(app: AppHandle) -> AccountStatus {
    account(&app).status()
}

/// Random id for this computer, kept in the Credential Manager so it
/// survives reinstalls. The server uses it to count connected computers
/// (signing in again on the same one replaces its old session).
fn machine_id() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, "machine-id").ok()?;
    if let Ok(id) = entry.get_password() {
        return Some(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    entry.set_password(&id).ok()?;
    Some(id)
}

/// What the server stores for this computer (sha256 of "machine:<id>", see
/// device.ts) — plan tokens carry it and must match.
fn machine_hash() -> Option<String> {
    use sha2::{Digest, Sha256};
    static HASH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    HASH.get_or_init(|| {
        let id = machine_id()?;
        let digest = Sha256::digest(format!("machine:{id}").as_bytes());
        Some(digest.iter().map(|b| format!("{b:02x}")).collect())
    })
    .clone()
}

/// After each counted use: tell the server in the background, so the
/// account's daily totals survive local files being deleted.
pub fn report_usage_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !account(&app).is_active() {
            return;
        }
        if let Ok(token) = access_token(&app).await {
            crate::plans::sync_usage(&app, &token).await;
        }
    });
}

fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Computador".into())
}

/// Starts browser sign-in: gets a code, opens the confirmation page, and
/// polls in the background until the user confirms (or it expires).
#[tauri::command]
pub async fn account_start_login(app: AppHandle) -> Result<AccountStatus, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        device_name: String,
        platform: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        machine_id: Option<String>,
    }
    let code: api::DeviceCodeResponse = api::post(
        "/device/code",
        &Body {
            device_name: computer_name(),
            platform: std::env::consts::OS.into(),
            machine_id: machine_id(),
        },
        None,
    )
    .await
    .map_err(|e| e.message())?;

    let generation = account(&app).login_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let status = AccountStatus::Pending {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri_complete.clone(),
    };
    set_status(&app, status.clone());
    let _ = app.opener().open_url(&code.verification_uri_complete, None::<&str>);

    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        poll_login(poll_app, code, generation).await;
    });
    Ok(status)
}

async fn poll_login(app: AppHandle, code: api::DeviceCodeResponse, generation: u64) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body<'a> {
        device_code: &'a str,
    }
    let deadline = now_ms() + code.expires_in * 1000;
    let mut interval = code.interval.max(2);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if account(&app).login_gen.load(Ordering::SeqCst) != generation {
            return; // cancelled or superseded
        }
        if now_ms() > deadline {
            set_status(&app, AccountStatus::SignedOut { message: Some("O código expirou. Tente entrar novamente.".into()) });
            return;
        }
        let result: Result<api::TokenResponse, ApiError> =
            api::post("/device/token", &Body { device_code: &code.device_code }, None).await;
        match result {
            Ok(tokens) => {
                save_refresh_token(&tokens.refresh_token);
                store_set(&app, USER_KEY, serde_json::json!(tokens.user));
                {
                    let mut inner = account(&app).inner.lock().unwrap();
                    inner.user = Some(tokens.user.clone());
                    inner.access = Some((tokens.access_token, tokens.access_token_expires_at));
                }
                // The fresh session is only a few seconds old: sync uses it
                // to fetch the plan.
                match sync(&app).await {
                    Ok(()) => enter_app(&app),
                    Err(e) if e.code() == "terms_required" => {}
                    Err(e) => set_status(&app, AccountStatus::SignedOut { message: Some(e.message()) }),
                }
                return;
            }
            Err(e) => match e.code() {
                "authorization_pending" => {}
                "slow_down" => interval += 5,
                "network" => {} // keep trying until the code expires
                _ => {
                    set_status(&app, AccountStatus::SignedOut { message: Some(e.message()) });
                    return;
                }
            },
        }
    }
}

#[tauri::command]
pub fn account_cancel_login(app: AppHandle) {
    account(&app).login_gen.fetch_add(1, Ordering::SeqCst);
    set_status(&app, AccountStatus::SignedOut { message: None });
}

/// Retry after "no connection" / "accept the new terms".
#[tauri::command]
pub async fn account_retry(app: AppHandle) -> AccountStatus {
    if sync(&app).await.is_ok() && account(&app).is_active() {
        enter_app(&app);
    }
    account(&app).status()
}

#[tauri::command]
pub async fn account_logout(app: AppHandle) {
    if let Ok(token) = access_token(&app).await {
        let _: Result<serde_json::Value, ApiError> = api::post("/auth/logout", &serde_json::json!({}), Some(&token)).await;
    }
    account(&app).login_gen.fetch_add(1, Ordering::SeqCst);
    clear_local(&app);
    set_status(&app, AccountStatus::SignedOut { message: None });
    leave_app(&app);
}

/// Opens a page of the website (account, sign-up, terms...).
#[tauri::command]
pub fn account_open_site(app: AppHandle, path: String) -> Result<(), String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Caminho inválido.".into());
    }
    app.opener()
        .open_url(format!("{}{path}", api::SERVER_URL), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Debug builds: use the app without an account (API not running locally).
#[tauri::command]
pub fn account_dev_mode(app: AppHandle) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Indisponível nesta versão.".into());
    }
    set_status(&app, AccountStatus::DevMode);
    enter_app(&app);
    Ok(())
}
