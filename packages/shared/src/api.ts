/** Request/response shapes shared by the API (server/) and the website
 * (web/). The desktop app talks to a subset of these from Rust
 * (src-tauri/src/account/). */
import type { PaidTier, Tier } from "./plans";

export type Role = "user" | "admin";
export type UserStatus = "active" | "blocked";

export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. "invalid_credentials". */
    code: string;
    /** Human-readable message in Portuguese. */
    message: string;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: number;
}

export interface Entitlements {
  diamond: boolean;
  /** Paid tier per tool; tools not listed are on Grátis. */
  tools: Record<string, Exclude<Tier, "free">>;
}

export interface Me {
  user: User;
  entitlements: Entitlements;
  /** Latest published terms version, and whether this user accepted it. */
  terms: { currentVersion: number; accepted: boolean };
  /** Tools this user chose to install (download page). */
  tools: string[];
}

export interface AuthResponse {
  accessToken: string;
  /** Epoch ms. */
  accessTokenExpiresAt: number;
  user: User;
}

/** Desktop clients get the refresh token in the body (browsers get it as an
 * HttpOnly cookie instead). */
export interface DesktopTokenResponse extends AuthResponse {
  refreshToken: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  acceptedTermsVersion: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SessionInfo {
  id: string;
  kind: "web" | "desktop";
  deviceName: string | null;
  platform: string | null;
  userAgent: string | null;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

// --- Device authorization (desktop login through the browser, RFC 8628) ---

export interface DeviceCodeRequest {
  deviceName: string;
  platform: string;
}

export interface DeviceCodeResponse {
  deviceCode: string;
  /** Short code the user confirms on the website, e.g. "KXQD-7MWP". */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Seconds. */
  expiresIn: number;
  /** Minimum seconds between polls. */
  interval: number;
}

export type DeviceTokenError = "authorization_pending" | "slow_down" | "access_denied" | "expired_token";

export interface DeviceLookupResponse {
  userCode: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: number;
}

// --- Terms ---

export interface TermsVersion {
  version: number;
  title: string;
  /** Markdown. */
  content: string;
  publishedAt: number;
}

// --- Downloads ---

export type ReleaseKind = "app" | "dependency";

export interface Release {
  id: string;
  kind: ReleaseKind;
  /** "windows-x64" for the app; the dependency id for dependencies. */
  target: string;
  version: string;
  fileName: string;
  size: number;
  sha256: string;
  notes: string | null;
  publishedAt: number;
}

export interface DownloadsResponse {
  /** Latest app installer per platform. */
  app: Release[];
  /** Latest release of each dependency. */
  dependencies: Release[];
}

export interface DownloadLinkResponse {
  url: string;
  expiresAt: number;
}

// --- Admin ---

export interface Subscription {
  id: string;
  userId: string;
  /** "*" for Diamante. */
  toolId: string;
  tier: PaidTier;
  status: "active" | "canceled";
  startsAt: number;
  endsAt: number | null;
  source: string;
  note: string | null;
  createdAt: number;
}

export interface AdminUserSummary extends User {
  lastSeenAt: number | null;
  activeSubscriptions: number;
}

export interface AdminUserDetail {
  user: User;
  subscriptions: Subscription[];
  sessions: SessionInfo[];
  entitlements: Entitlements;
  tools: string[];
}

export interface AuditEntry {
  id: number;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  details: string | null;
  createdAt: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}
