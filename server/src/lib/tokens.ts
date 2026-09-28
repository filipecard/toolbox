/** Compact JWS tokens:
 * - access tokens: HS256, short-lived, verified by this API only;
 * - entitlement tokens: EdDSA (Ed25519), verified offline by the desktop
 *   app with the public key embedded in it — so the plan can't be forged
 *   or edited locally, and still works for a while without internet. */
import type { Entitlements, Role } from "@toolbox/shared";
import { base64ToBytes, base64url, base64urlToBytes, hmacSign, hmacVerify } from "./crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
/** How long the desktop app keeps working offline on its last plan. */
export const ENTITLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function encodeJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(decoder.decode(base64urlToBytes(segment))) as T;
}

// --- Access tokens ---

export interface AccessClaims {
  sub: string;
  sid: string;
  role: Role;
  /** Seconds (JWT convention). */
  iat: number;
  exp: number;
}

export async function signAccessToken(
  secret: string,
  claims: { sub: string; sid: string; role: Role },
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + ACCESS_TOKEN_TTL_MS;
  const payload: AccessClaims = {
    ...claims,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000),
  };
  const signingInput = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson(payload)}`;
  return { token: `${signingInput}.${await hmacSign(secret, signingInput)}`, expiresAt };
}

/** Null for anything invalid: bad format, wrong algorithm, bad signature, expired. */
export async function verifyAccessToken(secret: string, token: string, now = Date.now()): Promise<AccessClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    if (decodeJson<{ alg?: string }>(header).alg !== "HS256") return null;
    if (!(await hmacVerify(secret, `${header}.${payload}`, signature))) return null;
    const claims = decodeJson<AccessClaims>(payload);
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!claims.sub || !claims.sid) return null;
    return claims;
  } catch {
    return null;
  }
}

// --- Entitlement tokens ---

export interface EntitlementClaims extends Entitlements {
  /** User id. */
  sub: string;
  /** Session (desktop install) the token was issued to. */
  sid: string;
  email: string;
  iat: number;
  exp: number;
}

async function importSigningKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", base64ToBytes(pkcs8Base64), { name: "Ed25519" }, false, ["sign"]);
}

export async function signEntitlementToken(
  privateKeyPkcs8Base64: string,
  claims: Omit<EntitlementClaims, "iat" | "exp">,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + ENTITLEMENT_TTL_MS;
  const payload: EntitlementClaims = {
    ...claims,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000),
  };
  const signingInput = `${encodeJson({ alg: "EdDSA", typ: "JWT" })}.${encodeJson(payload)}`;
  const key = await importSigningKey(privateKeyPkcs8Base64);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, encoder.encode(signingInput)));
  return { token: `${signingInput}.${base64url(signature)}`, expiresAt };
}

/** For tests and tooling — the desktop app has its own verifier in Rust. */
export async function verifyEntitlementToken(
  publicKeyRawBase64: string,
  token: string,
): Promise<EntitlementClaims | null> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKeyRawBase64), { name: "Ed25519" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    base64urlToBytes(signature),
    encoder.encode(`${header}.${payload}`),
  );
  return ok ? decodeJson<EntitlementClaims>(payload) : null;
}
