export type StatusCode = 200 | 201 | 202 | 400 | 401 | 403 | 404 | 500;


export default class HttpError extends Error {
  name: string;
  public status: StatusCode;
  stack?: string | undefined;

  constructor(message: string, statusCode: StatusCode) {
    super(message);
    this.name = this.constructor.name
    this.status = statusCode;
    this.stack = new Error().stack;

    Object.setPrototypeOf(this, new.target.prototype);

  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(message, 400);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class UnexpectedError extends HttpError {
  constructor(message = "An unexpected error occurred") {
    super(message, 500);
    this.name = "UnexpectedError";
  }
}

export class FirebaseError extends HttpError {
  constructor(message = "Firebase error") {
    super(message, 500);
    this.name = "FirebaseError";
  }
}
