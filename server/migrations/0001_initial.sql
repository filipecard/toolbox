-- ToolBox accounts, sessions, licensing and downloads.
-- Timestamps are epoch milliseconds (INTEGER); booleans are 0/1.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  -- "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>"
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per signed-in client: a browser, or a desktop install.
-- Refresh tokens are opaque random strings; only their SHA-256 is stored.
-- They rotate on every use: a token presented after it was rotated away
-- (previous_refresh_hash) means it leaked, and the session is revoked.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'desktop')),
  device_name TEXT,
  platform TEXT,
  user_agent TEXT,
  ip TEXT,
  refresh_hash TEXT NOT NULL UNIQUE,
  previous_refresh_hash TEXT,
  rotated_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_previous ON sessions(previous_refresh_hash);

-- Desktop login through the browser (OAuth 2.0 Device Authorization Grant).
CREATE TABLE device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  device_name TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_polled_at INTEGER
);

-- Single-use links sent by e-mail (verify address, reset password).
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);

-- What each user is entitled to. tool_id '*' with tier 'diamond' is the
-- Diamante plan (every tool, no limits). Granted by an admin for now;
-- payments will create rows with source = 'payment'.
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('basic', 'silver', 'gold', 'diamond')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  source TEXT NOT NULL DEFAULT 'admin',
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  CHECK ((tool_id = '*') = (tier = 'diamond'))
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, status);

-- Terms of use: every published version is kept; users must accept the
-- latest before using their account.
CREATE TABLE terms_versions (
  version INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE terms_acceptances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL REFERENCES terms_versions(version),
  accepted_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  PRIMARY KEY (user_id, version)
);

-- Tools each user chose on the download page.
CREATE TABLE user_tools (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_id)
);

-- Files in R2: app installers and per-tool dependency packages.
CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('app', 'dependency')),
  target TEXT NOT NULL,
  version TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  notes TEXT,
  published_at INTEGER NOT NULL,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_releases_target ON releases(kind, target, published_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_target ON audit_log(target_user_id, created_at);

-- Fixed-window counters for rate limiting (login, signup, e-mails...).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
