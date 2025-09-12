import { prisma } from "../lib/prisma";
import { generateApiKey, hashApiKey } from "../utils/apiKey";

export async function createApiKey(serviceName: string, adminId?: string) {
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);

  const apiKey = await prisma.apikey.create({
    data: {
      keyHash,
      serviceName,
      adminId,
    },
  });

  return { serviceName, rawKey, apiKey };
  // rawKey dikirim sekali ke admin, jangan disimpan di DB
}
