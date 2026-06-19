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
 * Shape of a Prisma known-request error (PrismaClientKnownRequestError).
 * Duck-typed instead of `instanceof` so detection keeps working when the
 * `@prisma/client` module is mocked in tests (the mock only exposes PrismaClient).
 */
export interface PrismaKnownError {
  name: string;
  code: string;
  meta?: Record<string, unknown>;
}

export function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'PrismaClientKnownRequestError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/**
 * Map the most common Prisma error codes to the HTTP semantics of spec §3.11.
 * Returns null for unmapped codes so the caller can fall back to a logged 500.
 *
 *  - P2002 unique constraint  → 409 (e.g. duplicate Step.sort_order in a recipe)
 *  - P2003 FK constraint      → 422 (e.g. recipe references a missing category/tag)
 *  - P2025 record not found    → 404 (nested update/delete on a missing row)
 */
export function mapPrismaError(err: PrismaKnownError): AppError | null {
  switch (err.code) {
    case 'P2002':
      return new ConflictError('Resource already exists');
    case 'P2003':
      return new UnprocessableError('Referenced resource does not exist');
    case 'P2025':
      return new NotFoundError('Resource not found');
    default:
      return null;
  }
}
