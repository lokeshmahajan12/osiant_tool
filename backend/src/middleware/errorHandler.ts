import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import { ValidationError } from "../utils/input";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Wrap an async route handler so rejected promises are forwarded to Express's
 * error middleware. Express 4 does not catch async rejections on its own.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
}

/**
 * Render an error using the structured envelope:
 * `{ success: false, error: { code, message, details? } }`.
 * The previous flat `{ error: "message" }` shape is preserved for legacy
 * clients by including the same fields the old handler produced.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code ?? "API_ERROR", message: err.message },
    });
    return;
  }

  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({
      success: false,
      error: { code: "API_ERROR", message: (err as Error).message ?? "Request failed" },
    });
    return;
  }

  logger.error({ err }, "unhandled error");
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
