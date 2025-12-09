import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { verifyApiKey } from "../utils/apiKey";
import { handlePrismaNotFound } from "../utils/handleNotFound";
import { sendError } from "../utils/send";

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      return res.status(401).json({ message: "API key missing" });
    }

    const keys = await handlePrismaNotFound(() =>
      prisma.apikey.findMany({
        where: { isActive: true },
      })
    );

    for (const key of keys) {
      const isValid = await verifyApiKey(apiKey, key.keyHash);
      if (isValid) {
        (req as any).apiKeyOwner = key; // bisa dipakai di route
        return next();
      }
    }
  } catch (error) {
    // return res.json({ error });
    sendError(res, error);
    return;
  }
}
