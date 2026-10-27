//! Verification of the plan token the server signs (Ed25519). The public
//! key is compiled into the app: nothing on disk can make the app accept a
//! plan the server didn't issue.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::plans::Tier;

/// Release builds must set TOOLBOX_ENTITLEMENT_PUBLIC_KEY (the production
/// key, see server/scripts/generate-keys.mjs); debug builds fall back to the
/// development key the same script writes to keys/.
const PUBLIC_KEY_B64: &str = match option_env!("TOOLBOX_ENTITLEMENT_PUBLIC_KEY") {
    Some(key) => key,
    None => include_str!("../../keys/entitlement_public.b64"),
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntitlementClaims {
    pub sub: String,
    pub sid: String,
    /// Hash of the computer the token was issued to (see account::machine_hash).
    /// Absent only for sessions opened before machine ids existed.
    #[serde(default)]
    pub mid: Option<String>,
    pub email: String,
    #[serde(default)]
    pub diamond: bool,
    #[serde(default)]
    pub tools: HashMap<String, Tier>,
    /// Seconds since the epoch.
    pub iat: u64,
    pub exp: u64,
}

#[derive(Debug, PartialEq)]
pub enum VerifyError {
    Malformed,
    BadSignature,
    WrongUser,
    /// Issued to another computer (the plan file was copied).
    WrongMachine,
    Expired,
}

fn public_key() -> Result<VerifyingKey, VerifyError> {
    let bytes = STANDARD.decode(PUBLIC_KEY_B64.trim()).map_err(|_| VerifyError::Malformed)?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| VerifyError::Malformed)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| VerifyError::Malformed)
}

/// Checks signature, owner, computer and expiry. `now_s` is the current
/// time in seconds (after the clock-rollback check done by the caller).
pub fn verify(
    token: &str,
    expected_user: &str,
    machine: Option<&str>,
    now_s: u64,
) -> Result<EntitlementClaims, VerifyError> {
    verify_with_key(&public_key()?, token, expected_user, machine, now_s)
}

fn verify_with_key(
    key: &VerifyingKey,
    token: &str,
    expected_user: &str,
    machine: Option<&str>,
    now_s: u64,
) -> Result<EntitlementClaims, VerifyError> {
    let mut parts = token.split('.');
    let (Some(header), Some(payload), Some(signature), None) = (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(VerifyError::Malformed);
    };

    #[derive(Deserialize)]
    struct Header {
        alg: String,
    }
    let header_json = URL_SAFE_NO_PAD.decode(header).map_err(|_| VerifyError::Malformed)?;
    let parsed: Header = serde_json::from_slice(&header_json).map_err(|_| VerifyError::Malformed)?;
    if parsed.alg != "EdDSA" {
        return Err(VerifyError::Malformed);
    }

    let sig_bytes = URL_SAFE_NO_PAD.decode(signature).map_err(|_| VerifyError::Malformed)?;
    let signature = Signature::from_slice(&sig_bytes).map_err(|_| VerifyError::Malformed)?;
    let signing_input = format!("{header}.{payload}");
    key.verify_strict(signing_input.as_bytes(), &signature)
        .map_err(|_| VerifyError::BadSignature)?;

    let payload_json = URL_SAFE_NO_PAD.decode(payload).map_err(|_| VerifyError::Malformed)?;
    let claims: EntitlementClaims = serde_json::from_slice(&payload_json).map_err(|_| VerifyError::Malformed)?;
    if claims.sub != expected_user {
        return Err(VerifyError::WrongUser);
    }
    if let (Some(mid), Some(machine)) = (claims.mid.as_deref(), machine) {
        if mid != machine {
            return Err(VerifyError::WrongMachine);
        }
    }
    if claims.exp <= now_s {
        return Err(VerifyError::Expired);
    }
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn sign(key: &SigningKey, payload: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"EdDSA","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(payload);
        let sig = key.sign(format!("{header}.{payload}").as_bytes());
        format!("{header}.{payload}.{}", URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    const CLAIMS: &str =
        r#"{"sub":"u1","sid":"s1","email":"a@b.com","diamond":false,"tools":{"ocr":"silver"},"iat":100,"exp":2000}"#;

    #[test]
    fn accepts_a_valid_token() {
        let claims = verify_with_key(&key().verifying_key(), &sign(&key(), CLAIMS), "u1", None, 1000).unwrap();
        assert_eq!(claims.tools.get("ocr"), Some(&Tier::Silver));
    }

    #[test]
    fn rejects_edits_other_keys_other_users_and_expiry() {
        let token = sign(&key(), CLAIMS);
        let vk = key().verifying_key();

        // Editing the plan in the payload breaks the signature.
        let parts: Vec<&str> = token.split('.').collect();
        let forged_payload = URL_SAFE_NO_PAD.encode(CLAIMS.replace("silver", "gold"));
        let forged = format!("{}.{}.{}", parts[0], forged_payload, parts[2]);
        assert_eq!(verify_with_key(&vk, &forged, "u1", None, 1000), Err(VerifyError::BadSignature));

        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(verify_with_key(&vk, &sign(&other, CLAIMS), "u1", None, 1000), Err(VerifyError::BadSignature));
        assert_eq!(verify_with_key(&vk, &token, "u2", None, 1000), Err(VerifyError::WrongUser));
        assert_eq!(verify_with_key(&vk, &token, "u1", None, 2000), Err(VerifyError::Expired));
        assert_eq!(verify_with_key(&vk, "a.b", "u1", None, 1000), Err(VerifyError::Malformed));
    }

    #[test]
    fn rejects_a_token_issued_to_another_computer() {
        let claims = CLAIMS.replace(r#""sid":"s1","#, r#""sid":"s1","mid":"machine-a","#);
        let token = sign(&key(), &claims);
        let vk = key().verifying_key();
        assert!(verify_with_key(&vk, &token, "u1", Some("machine-a"), 1000).is_ok());
        assert_eq!(verify_with_key(&vk, &token, "u1", Some("machine-b"), 1000), Err(VerifyError::WrongMachine));
    }

    #[test]
    fn embedded_key_is_valid() {
        assert!(public_key().is_ok());
    }
}
