import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { verifyApiKey } from "../utils/apiKey";
import logger from "../utils/logger";

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-api-key");
  if (!apiKey) return res.status(401).json({ message: "API key missing" });

  try {
    const keys = await prisma.apikey.findMany({ where: { isActive: true } });
    for (const key of keys) {
      if (key.isActive && (!key.expiresAt || key.expiresAt.getTime() > Date.now()) && await verifyApiKey(apiKey, key.keyHash)) {
        return next();
      }
    }
    return res.status(401).json({ message: "Invalid API key" });
  } catch {
    logger.error("image.auth.failed");
    return res.status(500).json({ message: "An unexpected error occurred" });
  }
}
