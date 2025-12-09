import { Response } from "express";

import HttpError, { StatusCode } from "../error/responseError";

export function sendData<T = object>(res: Response, data?: T, message: string = "success", status: StatusCode = 200) {
    res
        .status(status)
        .json({
            message,
            ...data
        });
}

export function sendError(res: Response, error: any, status: StatusCode = 500, message: string = "An unexpected error occurred") {
    if (error instanceof HttpError) {
        res
            .status(error.status).json({
                message: error.message,
                error
            });
    } else {
        res
            .status(status).json({
                message,
                error
            });
    }
}

