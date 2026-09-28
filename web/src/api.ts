/** API client. The access token lives only in memory (never in
 * localStorage, where any injected script could read it); the refresh token
 * is an HttpOnly cookie the browser sends to /api/auth only. On a 401 the
 * client refreshes once and retries. */
import type {
  AdminUserDetail,
  AdminUserSummary,
  ApiErrorBody,
  AuditEntry,
  AuthResponse,
  DependencyInfo,
  DeviceLookupResponse,
  DownloadLinkResponse,
  DownloadsResponse,
  FeatureLimit,
  Me,
  Paginated,
  PaidTier,
  Release,
  SessionInfo,
  TermsVersion,
  ToolInfo,
} from "@toolbox/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Called when a refresh fails: the session is gone. */
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "network", err?.message ?? "Não foi possível falar com o servidor.");
  }
  return body as T;
}

// One refresh at a time: parallel 401s all wait for the same attempt
// (the refresh token rotates, so a second concurrent refresh would fail).
let refreshing: Promise<AuthResponse | null> | null = null;

export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "x-toolbox-client": "web" },
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const auth = (await res.json()) as AuthResponse;
      accessToken = auth.accessToken;
      return auth;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "x-toolbox-client": "web",
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique sua internet.");
  }
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    accessToken = null;
    onSessionLost?.();
  }
  return parse<T>(res);
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

export const api = {
  catalog: () => get<{ tools: ToolInfo[]; dependencies: DependencyInfo[]; limits: FeatureLimit[] }>("/catalog"),
  currentTerms: () => get<TermsVersion>("/terms/current"),

  signup: (b: { name: string; email: string; password: string; acceptedTermsVersion: number }) =>
    post<AuthResponse>("/auth/signup", b),
  login: (b: { email: string; password: string }) => post<AuthResponse>("/auth/login", b),
  logout: () => post<void>("/auth/logout"),
  verifyEmail: (token: string) => post<{ ok: true }>("/auth/verify-email", { token }),
  resendVerification: () => post<{ ok: true }>("/auth/resend-verification"),
  forgotPassword: (email: string) => post<{ ok: true }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => post<{ ok: true }>("/auth/reset-password", { token, password }),

  me: () => get<Me>("/me"),
  updateName: (name: string) => patch<Me>("/me", { name }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>("/me/password", { currentPassword, newPassword }),
  sessions: () => get<SessionInfo[]>("/me/sessions"),
  revokeSession: (id: string) => del<void>(`/me/sessions/${id}`),
  setTools: (tools: string[]) => put<{ tools: string[] }>("/me/tools", { tools }),
  acceptTerms: (version: number) => post<{ ok: true }>("/me/terms/accept", { version }),

  deviceLookup: (code: string) => get<DeviceLookupResponse>(`/device/lookup?code=${encodeURIComponent(code)}`),
  deviceApprove: (code: string) => post<{ ok: true }>("/device/approve", { code }),
  deviceDeny: (code: string) => post<{ ok: true }>("/device/deny", { code }),

  downloads: () => get<DownloadsResponse>("/downloads"),
  downloadLink: (releaseId: string) => post<DownloadLinkResponse>(`/downloads/${releaseId}/link`),

  admin: {
    users: (q: string, page: number) =>
      get<Paginated<AdminUserSummary>>(`/admin/users?q=${encodeURIComponent(q)}&page=${page}`),
    user: (id: string) => get<AdminUserDetail>(`/admin/users/${id}`),
    updateUser: (id: string, b: { role?: "user" | "admin"; status?: "active" | "blocked"; emailVerified?: boolean }) =>
      patch<AdminUserDetail>(`/admin/users/${id}`, b),
    revokeSessions: (id: string) => del<AdminUserDetail>(`/admin/users/${id}/sessions`),
    grant: (id: string, b: { toolId: string; tier: PaidTier; endsAt: number | null; note: string | null }) =>
      post<AdminUserDetail>(`/admin/users/${id}/subscriptions`, b),
    cancelSubscription: (id: string) => del<AdminUserDetail>(`/admin/subscriptions/${id}`),
    terms: () => get<TermsVersion[]>("/admin/terms"),
    publishTerms: (title: string, content: string) => post<{ version: number }>("/admin/terms", { title, content }),
    releases: () => get<Release[]>("/admin/releases"),
    uploadRelease: (form: FormData) => post<Release>("/admin/releases", form),
    registerRelease: (b: {
      kind: "app" | "dependency";
      target: string;
      version: string;
      notes: string | null;
      r2Key: string;
      fileName: string;
    }) => post<Release>("/admin/releases/register", b),
    deleteRelease: (id: string) => del<void>(`/admin/releases/${id}`),
    audit: (userId?: string) => get<AuditEntry[]>(`/admin/audit${userId ? `?userId=${userId}` : ""}`),
  },
};
