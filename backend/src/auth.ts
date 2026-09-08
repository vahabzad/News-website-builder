import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  userId?: string;
}

function secret() {
  return process.env.JWT_SECRET || "local-development-secret-change-me";
}

export function createToken(userId: string) {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: "7d", issuer: "news-site-builder" });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "ابتدا وارد حساب کاربری شوید." });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), secret(), { issuer: "news-site-builder" });
    req.userId = typeof payload === "string" ? undefined : payload.sub;
    if (!req.userId) throw new Error("INVALID_TOKEN");
    next();
  } catch {
    res.status(401).json({ message: "نشست کاربری معتبر نیست." });
  }
}
