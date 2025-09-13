import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { verifyApiKey } from "../utils/apiKey";

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    return res.status(401).json({ message: "API key missing" });
  }

  const keys = await prisma.apikey.findMany({
    where: { isActive: true },
  });

  for (const key of keys) {
    const isValid = await verifyApiKey(apiKey, key.keyHash);
    if (isValid) {
      (req as any).apiKeyOwner = key; // bisa dipakai di route
      return next();
    }
  }

  return res.status(403).json({ message: "Invalid API key" });
}
