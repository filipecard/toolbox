/** Crypto helpers on the Web Crypto API only (runs on Workers and Node). */

const encoder = new TextEncoder();

/** Bytes backed by a plain ArrayBuffer — what Web Crypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Bytes {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBytes(value: string): Bytes {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Unguessable opaque token (refresh tokens, e-mail links, device codes). */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export async function sha256Hex(value: string | Bytes): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking, through timing, how many leading bytes match. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  return constantTimeEqual(encoder.encode(a), encoder.encode(b));
}

// --- Passwords ---
// PBKDF2-SHA256 is the strongest password hash Web Crypto offers (no
// Argon2/scrypt on Workers). 100 000 iterations is the Workers maximum.

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !hash) return false;
  const candidate = await pbkdf2(password, base64ToBytes(salt), Number(iterations));
  return constantTimeEqual(candidate, base64ToBytes(hash));
}

/** Computed once so a login for an unknown e-mail spends the same time as
 * a wrong password — the response time doesn't reveal which e-mails exist. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

// --- HMAC (download links) ---

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message));
  return base64url(new Uint8Array(sig));
}

export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  let sig: Bytes;
  try {
    sig = base64urlToBytes(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(message));
}

// --- Device user codes ---

/** No 0/O, 1/I/L, 5/S, 2/Z: easy to read aloud and type. */
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";

/** "KXQD-7MWP": 8 characters from a 27-letter alphabet (~38 bits), plenty
 * for a code that lives 10 minutes behind a login and a rate limit. */
export function generateUserCode(): string {
  const chars: string[] = [];
  // Rejection sampling: no modulo bias.
  const limit = 256 - (256 % USER_CODE_ALPHABET.length);
  while (chars.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < limit && chars.length < 8) chars.push(USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Accepts what people type: lowercase, missing dash, spaces. */
export function normalizeUserCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 8 || [...clean].some((c) => !USER_CODE_ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}
