import crypto from "crypto";
import bcrypt from "bcryptjs";

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex"); // API key panjang random
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(apiKey, salt);
}

export async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  return bcrypt.compare(apiKey, hash);
}
