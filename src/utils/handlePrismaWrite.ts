import { Prisma } from "@prisma/client";
import HttpError from "../error/responseError";

export async function handlePrismaWrite<T>(
    fn: () => Promise<T>,
    defaultMessage = 'Failed to perform write operation'
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                case 'P2002': // Unique constraint failed

                    throw new HttpError('Duplicate value', 400);
                case 'P2003': // Foreign key constraint failed

                    throw new HttpError("Foreign key constraint failed", 400);
                case 'P2004': // DB constraint failed (usually with raw SQL)

                    throw new HttpError('A database constraint failed', 400);
                // Add more cases as needed based on your application's needs

                default:
                    throw new HttpError(`${defaultMessage}: ${error.message}`, 500);
            }
        }
        throw error; // unknown error, rethrow
    }
}