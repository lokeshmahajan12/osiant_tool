import { setTimeout as sleep } from "node:timers/promises";
import { env } from "../config/env";
import { logger } from "./logger";

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  /** Status codes that are retried (in addition to network errors). */
  retryOnStatus?: number[];
  /** Status codes treated as a successful response. Default: 2xx. */
  allowedStatuses?: number[];
  /** Follow HTTP redirects (default: false — redirects are not followed). */
  followRedirects?: boolean;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly rateLimited: boolean;

  constructor(message: string, status: number, body: unknown, rateLimited = false) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.rateLimited = rateLimited;
  }
}

export interface HttpResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

const RETRYABLE_NETWORK = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

function buildUrl(url: string, params?: HttpRequestOptions["params"]): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/**
 * HTTP client with timeout, retries with exponential backoff (with jitter)
 * and explicit handling of 429 (rate limited). Never follows redirects.
 */
export async function httpRequest<T = unknown>(opts: HttpRequestOptions): Promise<HttpResult<T>> {
  const {
    method = "GET",
    url,
    headers = {},
    params,
    body,
    timeoutMs = env.REQUEST_TIMEOUT_MS,
    maxRetries = env.MAX_RETRIES,
    backoffBaseMs = env.RETRY_BACKOFF_BASE_MS,
    retryOnStatus = [429, 500, 502, 503, 504],
    allowedStatuses,
    followRedirects = false,
  } = opts;

  const target = buildUrl(url, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let lastError: Error | undefined;
  let lastStatus = 0;

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(target, {
          method,
          headers: { Accept: "application/json", ...headers },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          redirect: followRedirects ? "follow" : "manual",
          signal: controller.signal,
        });

        const isAllowed = allowedStatuses ? allowedStatuses.includes(res.status) : res.status >= 200 && res.status < 300;

        if (isAllowed) {
          const text = res.status === 204 ? undefined : await res.text();
          const data = text ? (parseJson(text) as T) : (undefined as T);
          return { status: res.status, data, headers: res.headers };
        }

        lastStatus = res.status;
        const text = await res.text().catch(() => "");
        const parsed = parseJson(text);

        if (res.status === 429 || (retryOnStatus.includes(res.status) && attempt < maxRetries)) {
          const retryAfter = Number(res.headers.get("retry-after") ?? 0);
          const wait = retryAfter > 0 ? retryAfter * 1000 : backoffBaseMs * 2 ** attempt + Math.random() * 250;
          logger.debug({ provider: opts.url, attempt, waitMs: Math.round(wait), status: res.status }, "http retry");
          await sleep(wait);
          continue;
        }

        throw new HttpError(`HTTP ${res.status}`, res.status, parsed, res.status === 429);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const anyErr = err as NodeJS.ErrnoException;
        const retriable = anyErr.name === "AbortError" || RETRYABLE_NETWORK.has(anyErr.code ?? "");
        if (retriable && attempt < maxRetries) {
          lastError = anyErr;
          const wait = backoffBaseMs * 2 ** attempt + Math.random() * 250;
          logger.debug({ provider: opts.url, attempt, waitMs: Math.round(wait) }, "http network retry");
          await sleep(wait);
          continue;
        }
        throw anyErr;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  throw new HttpError(
    lastError ? `Request failed after retries: ${lastError.message}` : `Unhandled status ${lastStatus}`,
    lastStatus || 0,
    undefined
  );
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
