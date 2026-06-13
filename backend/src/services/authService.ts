import bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { JwtPayload } from '../plugins/jwt.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';
import type { RegisterBody, LoginBody, AuthResponse } from '../schemas/auth.js';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 10;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Duck-typed P2002 detection so the service stays decoupled from the concrete
// Prisma client (and works under the mocked client used in tests).
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

function uniqueViolationTarget(err: unknown): string[] {
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}

function getRefreshTokenExpiresAt(): Date {
  const str = config.JWT_REFRESH_EXPIRES_IN;
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error('Invalid JWT_REFRESH_EXPIRES_IN format');
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60 * 1_000,
    h: 60 * 60 * 1_000,
    d: 24 * 60 * 60 * 1_000,
  };
  return new Date(Date.now() + value * multipliers[unit]);
}

export function createAuthService(
  prisma: PrismaClient,
  signToken: (payload: JwtPayload) => string,
) {
  async function issueTokens(
    userId: string,
    username: string,
    isAdmin: boolean,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const payload: JwtPayload = { user_id: userId, username, is_admin: isAdmin };
    const access_token = signToken(payload);

    const rawRefreshToken = randomUUID();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = getRefreshTokenExpiresAt();

    await prisma.refreshToken.create({
      data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt },
    });

    return { access_token, refresh_token: rawRefreshToken };
  }

  return {
    async register(input: RegisterBody): Promise<AuthResponse> {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email: input.email }, { username: input.username }] },
        select: { email: true, username: true },
      });

      if (existing) {
        if (existing.email === input.email) {
          throw new ConflictError('Email is already taken');
        }
        throw new ConflictError('Username is already taken');
      }

      const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      let user;
      try {
        user = await prisma.user.create({
          data: { email: input.email, username: input.username, password_hash },
        });
      } catch (err) {
        // Race condition: a concurrent request inserted the same email/username
        // between the findFirst check and create. Map the unique-constraint
        // violation (Prisma P2002) to a 409 instead of a 500 (see §3.11).
        if (isUniqueViolation(err)) {
          const target = uniqueViolationTarget(err);
          if (target.includes('username')) {
            throw new ConflictError('Username is already taken');
          }
          throw new ConflictError('Email is already taken');
        }
        throw err;
      }

      const tokens = await issueTokens(user.id, user.username, user.is_admin);

      return { ...tokens, user: { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin } };
    },

    async login(input: LoginBody): Promise<AuthResponse> {
      const user = await prisma.user.findUnique({ where: { email: input.email } });

      if (!user || !user.is_active) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const passwordValid = await bcrypt.compare(input.password, user.password_hash);
      if (!passwordValid) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const tokens = await issueTokens(user.id, user.username, user.is_admin);

      return { ...tokens, user: { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin } };
    },

    async refresh(token: string): Promise<{ access_token: string }> {
      const tokenHash = hashToken(token);

      const record = await prisma.refreshToken.findUnique({
        where: { token_hash: tokenHash },
        include: {
          user: { select: { id: true, username: true, is_admin: true, is_active: true } },
        },
      });

      if (
        !record ||
        record.revoked ||
        record.expires_at < new Date() ||
        !record.user.is_active
      ) {
        throw new UnauthorizedError('Invalid or expired refresh token');
      }

      const payload: JwtPayload = {
        user_id: record.user.id,
        username: record.user.username,
        is_admin: record.user.is_admin,
      };

      return { access_token: signToken(payload) };
    },

    async logout(token: string): Promise<void> {
      const tokenHash = hashToken(token);

      const record = await prisma.refreshToken.findUnique({
        where: { token_hash: tokenHash },
      });

      if (!record || record.revoked) return;

      await prisma.refreshToken.update({
        where: { id: record.id },
        data: { revoked: true },
      });
    },
  };
}
