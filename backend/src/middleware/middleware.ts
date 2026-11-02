import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

export function middleware(req: Request, res: Response, next: NextFunction) {
  const authorization = req.get("authorization");
  const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({ success: false, message: "A Bearer token is required" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, message: "Authentication is not configured" });
  }

  try {
    const payload = jwt.verify(token, secret);
    const userId = typeof payload === "object" ? Number((payload as JwtPayload).id) : NaN;
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    res.locals.userId = userId;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

export function authenticatedUserId(res: Response): number {
  const userId = res.locals.userId;
  if (!Number.isSafeInteger(userId)) {
    throw new Error("Authenticated user id is missing");
  }
  return userId as number;
}
