import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : isProd ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "authorization",
      "headers.authorization",
      "req.headers.authorization",
      "apiKey",
      "api_key",
      "key",
      "secret",
      "cookie",
    ],
    censor: "[REDACTED]",
  },
  transport: !isProd && !isTest
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
});

export type Logger = typeof logger;
