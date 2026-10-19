import { prisma } from "../lib/prisma";
import { generateApiKey, hashApiKey } from "../utils/apiKey";

export async function createApiKey(serviceName: string, adminId: string) {
  adminId = adminId.toLowerCase();
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);

  await prisma.$transaction(async (tx) => {
    // A transaction-scoped lock also serializes rotations when no previous key exists.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${adminId}))`;
    await tx.apikey.deleteMany({ where: { adminId: { equals: adminId, mode: "insensitive" } } });
    await tx.apikey.create({ data: { keyHash, serviceName, adminId } });
  });
  return { rawKey };
}
