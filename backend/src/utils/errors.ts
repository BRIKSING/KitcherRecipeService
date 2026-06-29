/**
 * Кастомные HTTP-ошибки (Этап 1 — фундамент).
 *
 * `AppError` — базовый класс доменных ошибок, несущий тройку
 * (statusCode, detail, code). Глобальный error handler в `app.ts`
 * распознаёт наследников `AppError` и отдаёт их клиенту в едином формате
 * `{ detail, code }` (SPEC.md §3.7). Готовые наследники соответствуют
 * таблице кодов ошибок SPEC.md §3.11: 401, 403, 404, 409, 400, 422.
 *
 * `isFastifyError` — type-guard для ошибок самого Fastify (валидация,
 * rate-limit 429, multipart 413/415), которые обрабатываются отдельной
 * веткой error handler-а.
 */
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
