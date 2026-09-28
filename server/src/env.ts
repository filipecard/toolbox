import type { Role } from "@toolbox/shared";

/** Bindings, vars and secrets (see wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Absent until an e-mail domain is onboarded — e-mails are then only logged. */
  EMAIL?: SendEmail;

  ENVIRONMENT: "production" | "development";
  WEB_BASE_URL: string;
  EMAIL_FROM: string;
  /** Comma-separated. */
  ADMIN_EMAILS: string;

  JWT_SECRET: string;
  DOWNLOAD_SIGNING_KEY: string;
  ENTITLEMENT_PRIVATE_KEY: string;
}

/** Who is calling, once the access token has been verified. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};
