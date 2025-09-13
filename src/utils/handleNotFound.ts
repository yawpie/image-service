
import { Prisma } from "@prisma/client";
import { BadRequestError} from "../error/responseError";
/**
 * Wraps a Prisma query and handles "not found" errors.
 * Works with `findUniqueOrThrow` or manually null-checking.
 */
export async function handlePrismaNotFound<T>(
    fn: () => Promise<T | null>,
    notFoundMessage = 'Resource not found'
): Promise<T> {
    try {
        const result = await fn();
        if (!result || (Array.isArray(result) && result.length === 0)) {
            throw new BadRequestError(notFoundMessage);
        }
        return result;
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025'
        ) {

            throw new BadRequestError(notFoundMessage);

        }
        throw error;
    }
}