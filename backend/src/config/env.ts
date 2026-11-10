import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const boolFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const intOptional = (fallback: number) =>
  z.string().optional().transform((v) => (v === undefined || v === "" ? fallback : Number.parseInt(v, 10)));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: intOptional(4000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // Public base URLs. APP_URL is the canonical link used to build enrollment
  // invites; the others let a tunneled/production deployment decouple the
  // frontend and backend origins. Never hard-code localhost in the app.
  APP_URL: z.string().default("http://localhost:5173"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  BACKEND_URL: z.string().default("http://localhost:4000"),
  WEBSOCKET_URL: z.string().default(""),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").default(
    "dev-only-insecure-secret-change-me-in-production-now"
  ),
  JWT_EXPIRES_IN: z.string().default("8h"),
  BCRYPT_ROUNDS: intOptional(12),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://osint:osint@localhost:5432/osint?schema=public"),

  ADMIN_EMAIL: z.string().email().default("admin@sentinel.local"),
  ADMIN_PASSWORD: z.string().min(8).default("ChangeMe!12345"),
  DEMO_ENABLED: boolFromString.default("true"),

  MOCK_MODE: boolFromString.default("true"),
  REQUEST_TIMEOUT_MS: intOptional(8000),
  MAX_RETRIES: intOptional(2),
  RETRY_BACKOFF_BASE_MS: intOptional(500),

  GLOBAL_RATE_LIMIT_WINDOW_MS: intOptional(60_000),
  GLOBAL_RATE_LIMIT_MAX: intOptional(120),
  AUTH_RATE_LIMIT_WINDOW_MS: intOptional(900_000),
  AUTH_RATE_LIMIT_MAX: intOptional(60),
  INVESTIGATION_RATE_LIMIT_WINDOW_MS: intOptional(3_600_000),
  INVESTIGATION_RATE_LIMIT_MAX: intOptional(60),

  // ----- Live location -----------------------------------------------------
  // Per-device max location pushes per window.
  LOCATION_PUSH_RATE_LIMIT_WINDOW_MS: intOptional(60_000),
  LOCATION_PUSH_RATE_LIMIT_MAX: intOptional(120),
  // Live-presence ladder: a session goes LIVE -> STALE when no fix/heartbeat
  // arrives within STALE_THRESHOLD, and STALE -> OFFLINE within OFFLINE
  // THRESHOLD. Both are bounded per session by the active update interval.
  LOCATION_STALE_THRESHOLD_MS: intOptional(20_000),
  // A device is considered offline when no fix arrives within this window
  // (bounded per session by the active update interval).
  LOCATION_OFFLINE_THRESHOLD_MS: intOptional(45_000),
  // An active location-sharing session automatically expires after this TTL.
  LOCATION_SESSION_TTL_MS: intOptional(24 * 60 * 60_000),
  // Location history is auto-deleted after this retention window. Minimum
  // retention means location data is never stored permanently by default.
  LOCATION_RETENTION_HOURS: intOptional(24),
  // How often the retention/expiry sweeper runs.
  LOCATION_RETENTION_SWEEP_MS: intOptional(60 * 60_000),
  // Old timestamps beyond this skew are rejected.
  LOCATION_MAX_TS_SKEW_MS: intOptional(10 * 60_000),
  // Cap on history points returned per request.
  LOCATION_HISTORY_MAX_POINTS: intOptional(2000),

  // ----- Enrollment links --------------------------------------------------
  // Default lifetime of a device-enrollment token (default 15 minutes).
  ENROLLMENT_TOKEN_TTL_MS: intOptional(15 * 60_000),
  // Per-IP budget for public enrollment-token info/redeem endpoints.
  ENROLLMENT_RATE_LIMIT_WINDOW_MS: intOptional(60_000),
  ENROLLMENT_RATE_LIMIT_MAX: intOptional(30),

  // ----- End-user portal (USER role) --------------------------------------
  // Current consent / privacy policy versions used on new permission records.
  CONSENT_VERSION: z.string().default("1.0"),
  PRIVACY_POLICY_VERSION: z.string().default("1.0"),
  // Registration limiter (per IP).
  REGISTER_RATE_LIMIT_WINDOW_MS: intOptional(60 * 60_000),
  REGISTER_RATE_LIMIT_MAX: intOptional(10),
  // Camera session management limiter (per user).
  CAMERA_RATE_LIMIT_WINDOW_MS: intOptional(60_000),
  CAMERA_RATE_LIMIT_MAX: intOptional(30),
  // Location push interval enforcement for user dashboards.
  USER_LOCATION_INTERVAL_MS: intOptional(10_000),
  // Whether end-user self-registration is enabled (disable in strict deployments).
  REGISTRATION_ENABLED: boolFromString.default("true"),

  HIBP_API_KEY: z.string().optional().default(""),
  HUNTER_API_KEY: z.string().optional().default(""),
  ABSTRACT_API_KEY: z.string().optional().default(""),
  ABUSEIPDB_API_KEY: z.string().optional().default(""),
  IPINFO_API_KEY: z.string().optional().default(""),
  VIRUSTOTAL_API_KEY: z.string().optional().default(""),
  SHODAN_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("[config] Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
