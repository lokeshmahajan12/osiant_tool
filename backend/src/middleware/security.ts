import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/**
 * Origin whitelist used by both the HTTP and Socket.IO CORS layers.
 * Cloudflare quick-tunnel origins (https://*.trycloudflare.com) and ngrok
 * origins (https://*.ngrok-free.app / *.ngrok-free.dev / *.ngrok.app /
 * *.ngrok.io) are allowed so the pairing invite link works when the app is
 * shared through `cloudflared` / `ngrok` during physical-device testing.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (env.CORS_ORIGINS.includes(origin)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)) return true;
  if (origin.startsWith("https://") && origin.endsWith(".trycloudflare.com")) return true;
  if (/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:ngrok-free\.app|ngrok-free\.dev|ngrok\.app|ngrok\.io)$/.test(origin)) return true;
  return false;
}

export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "https://*.openstreetmap.org",
          "https://*.tile.openstreetmap.org",
          "https://*.basemaps.cartocdn.com",
          "https://basemaps.cartocdn.com",
        ],
        connectSrc: [
          "'self'",
          "ws:",
          "wss:",
          "https://*.openstreetmap.org",
          "https://*.basemaps.cartocdn.com",
          "https://basemaps.cartocdn.com",
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Device-Token"],
    maxAge: 86400,
  }),
];

export const globalRateLimiter = rateLimit({
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MS,
  limit: env.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down and retry later." },
});

export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts — try again later." },
});

/** Per-IP limiter for the public self-registration endpoint. */
export const registerRateLimiter = rateLimit({
  windowMs: env.REGISTER_RATE_LIMIT_WINDOW_MS,
  limit: env.REGISTER_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts — try again later." },
});

/** Per-user limiter for camera session management endpoints. */
export const cameraRateLimiter = rateLimit({
  windowMs: env.CAMERA_RATE_LIMIT_WINDOW_MS,
  limit: env.CAMERA_RATE_LIMIT_MAX,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Camera session quota exceeded — retry later." },
});

export const investigationRateLimiter = rateLimit({
  windowMs: env.INVESTIGATION_RATE_LIMIT_WINDOW_MS,
  limit: env.INVESTIGATION_RATE_LIMIT_MAX,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Investigation quota exceeded — retry later." },
});

/**
 * Per-device limiter for the high-frequency location push endpoint. Keyed by
 * the authenticated device id so one misbehaving device cannot exhaust the
 * global budget.
 */
export const locationPushRateLimiter = rateLimit({
  windowMs: env.LOCATION_PUSH_RATE_LIMIT_WINDOW_MS,
  limit: env.LOCATION_PUSH_RATE_LIMIT_MAX,
  keyGenerator: (req) => (req.device?.id ? `device:${req.device.id}` : `ip:${req.ip}`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Location update quota exceeded — retry later." },
});

/** Per-user limiter for location management/history endpoints. */
export const locationAdminRateLimiter = rateLimit({
  windowMs: env.LOCATION_PUSH_RATE_LIMIT_WINDOW_MS,
  limit: env.LOCATION_PUSH_RATE_LIMIT_MAX,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many location requests — retry later." },
});

/**
 * Per-IP limiter for the public enrollment endpoints. Prevents brute-forcing
 * single-use enrollment tokens from the mobile page.
 */
export const enrollmentRateLimiter = rateLimit({
  windowMs: env.ENROLLMENT_RATE_LIMIT_WINDOW_MS,
  limit: env.ENROLLMENT_RATE_LIMIT_MAX,
  keyGenerator: (req) => `enroll:${req.ip}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many enrollment attempts — retry later." },
});
