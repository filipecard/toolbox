//! HTTP client for the ToolBox API (separate repository, not open source).

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

/// Where the API (and the website — same origin) lives. Release builds set
/// TOOLBOX_SERVER_URL; debug builds talk to `wrangler dev`.
pub const SERVER_URL: &str = match option_env!("TOOLBOX_SERVER_URL") {
    Some(url) => url,
    None => "http://127.0.0.1:8787",
};

#[derive(Debug, Clone, PartialEq)]
pub enum ApiError {
    /// No response: offline, DNS, timeout, server down.
    Network,
    /// The server answered with an error.
    Api { status: u16, code: String, message: String },
}

impl ApiError {
    pub fn code(&self) -> &str {
        match self {
            ApiError::Network => "network",
            ApiError::Api { code, .. } => code,
        }
    }

    pub fn message(&self) -> String {
        match self {
            ApiError::Network => "Sem conexão com o servidor do ToolBox. Verifique sua internet.".into(),
            ApiError::Api { message, .. } => message.clone(),
        }
    }

    /// The session itself is gone (revoked, expired, account blocked).
    pub fn is_session_lost(&self) -> bool {
        matches!(self, ApiError::Api { status: 401, .. })
            || matches!(self, ApiError::Api { code, .. } if code == "account_blocked")
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("ToolBox-Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client")
    })
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    code: String,
    message: String,
}

async fn send<T: DeserializeOwned>(req: reqwest::RequestBuilder) -> Result<T, ApiError> {
    let res = req.send().await.map_err(|_| ApiError::Network)?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|_| ApiError::Network)?;
    if !status.is_success() {
        let (code, message) = serde_json::from_slice::<ErrorBody>(&bytes)
            .map(|b| (b.error.code, b.error.message))
            .unwrap_or_else(|_| ("http_error".into(), format!("Erro {} do servidor.", status.as_u16())));
        return Err(ApiError::Api { status: status.as_u16(), code, message });
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError::Api {
        status: status.as_u16(),
        code: "bad_response".into(),
        message: "Resposta inesperada do servidor.".into(),
    })
}

pub async fn post<B: Serialize, T: DeserializeOwned>(path: &str, body: &B, token: Option<&str>) -> Result<T, ApiError> {
    let mut req = client().post(format!("{SERVER_URL}/api{path}")).json(body);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    send(req).await
}

pub async fn get<T: DeserializeOwned>(path: &str, token: &str) -> Result<T, ApiError> {
    send(client().get(format!("{SERVER_URL}/api{path}")).bearer_auth(token)).await
}

/// For file downloads (signed links): the raw response, streamed by the caller.
pub async fn get_raw(url: &str) -> Result<reqwest::Response, ApiError> {
    let res = reqwest::Client::builder()
        .user_agent(concat!("ToolBox-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| ApiError::Network)?
        .get(url)
        .send()
        .await
        .map_err(|_| ApiError::Network)?;
    if !res.status().is_success() {
        return Err(ApiError::Api {
            status: res.status().as_u16(),
            code: "download_failed".into(),
            message: format!("O download falhou (erro {}).", res.status().as_u16()),
        });
    }
    Ok(res)
}

// --- Response shapes (camelCase, see ToolBoxWEB/packages/shared/src/api.ts) ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub email_verified: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    pub access_token_expires_at: u64,
    pub refresh_token: String,
    pub user: ApiUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementResponse {
    pub token: String,
    pub tools: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: String,
    pub target: String,
    pub version: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Deserialize)]
pub struct DownloadsResponse {
    pub dependencies: Vec<Release>,
}

#[derive(Deserialize)]
pub struct DownloadLink {
    pub url: String,
}
