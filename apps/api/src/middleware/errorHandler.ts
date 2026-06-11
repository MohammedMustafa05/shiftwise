import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof Error && "status" in err && typeof (err as { status: number }).status === "number") {
    const e = err as Error & { status: number };
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error(err);
  const isProd = process.env.NODE_ENV === "production";
  res.status(500).json({
    error: isProd ? "Internal server error" : err instanceof Error ? err.message : "Internal server error",
  });
}

export function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}
