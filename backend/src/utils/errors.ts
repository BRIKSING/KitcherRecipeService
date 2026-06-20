import { FastifyError } from 'fastify';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly code: string,
  ) {
    super(detail);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'Resource not found') {
    super(404, detail, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Unauthorized') {
    super(401, detail, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'Forbidden') {
    super(403, detail, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(detail = 'Conflict') {
    super(409, detail, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(detail = 'Validation error') {
    super(400, detail, 'VALIDATION_ERROR');
  }
}

export class UnprocessableError extends AppError {
  constructor(detail = 'Unprocessable entity') {
    super(422, detail, 'UNPROCESSABLE');
  }
}

export function isFastifyError(err: unknown): err is FastifyError {
  return typeof err === 'object' && err !== null && 'statusCode' in err;
}

/**
 * Structural type guard for Prisma's PrismaClientKnownRequestError.
 *
 * Detected by shape (name + Pxxxx code) rather than `instanceof
 * Prisma.PrismaClientKnownRequestError` so it keeps working when tests mock
 * the `@prisma/client` module (the mock does not export the `Prisma`
 * namespace).
 */
export function isPrismaKnownError(err: unknown): err is { code: string; meta?: unknown } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'PrismaClientKnownRequestError' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    /^P\d{4}$/.test((err as { code: string }).code)
  );
}
