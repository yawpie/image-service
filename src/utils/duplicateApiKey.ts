import { prisma } from "../lib/prisma";
import { handlePrismaWrite } from "./handlePrismaWrite";

export const checkDuplicateKey = async (adminId: string) => {
  if (!adminId) throw new Error("Admin ID is required");
  try {
    const isDuplicate = await prisma.apikey.count({
      where: { adminId },
    });

    return isDuplicate > 0;
  } catch (error) {
    console.error("Database query error:", error);
    throw new Error("Database query error");
  }
};

export const deletePreviousKey = async (adminId: string) => {
  if (!adminId) throw new Error("Admin ID is required");
  try {
    await handlePrismaWrite(async () => {
      await prisma.apikey.deleteMany({
        where: { adminId },
      });
    }, "Failed to delete previous API key");
  } catch (error) {
    console.error("Database query error:", error);
    throw new Error("Database query error");
  }
};
