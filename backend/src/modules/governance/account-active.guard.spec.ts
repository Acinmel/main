import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountActiveGuard } from './account-active.guard';

function makeContext(params: {
  method?: string;
  userId?: string;
  url?: string;
}): ExecutionContext {
  const req = {
    method: params.method ?? 'GET',
    userId: params.userId,
    originalUrl:
      params.url ?? '/api/v1/video-projects/studio-current/stage-state',
    url: params.url ?? '/api/v1/video-projects/studio-current/stage-state',
  };
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('AccountActiveGuard', () => {
  function setup(params?: {
    isPublic?: boolean;
    gov?: {
      role: 'admin' | 'user';
      account_status: 'active' | 'pending' | 'disabled';
    } | null;
  }) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(params?.isPublic ?? false),
    } as unknown as Reflector;

    const auth = {
      findUserGovById: jest.fn().mockResolvedValue(params?.gov ?? null),
      assertAccountUsable: jest.fn().mockResolvedValue(undefined),
    };

    const guard = new AccountActiveGuard(reflector, auth as never);
    return { guard, auth, reflector };
  }

  it('allows public routes', async () => {
    const { guard } = setup({ isPublic: true });
    const ok = await guard.canActivate(makeContext({ userId: 'u1' }));
    expect(ok).toBe(true);
  });

  it('allows pending user on /auth/me', async () => {
    const { guard } = setup({
      gov: { role: 'user', account_status: 'pending' },
    });
    const ok = await guard.canActivate(
      makeContext({ userId: 'u1', url: '/api/v1/auth/me' }),
    );
    expect(ok).toBe(true);
  });

  it('throws ACCOUNT_PENDING for pending users on business APIs', async () => {
    const { guard } = setup({
      gov: { role: 'user', account_status: 'pending' },
    });
    await expect(
      guard.canActivate(
        makeContext({
          userId: 'u1',
          url: '/api/v1/video-projects/studio-current/stage-state',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await guard
      .canActivate(
        makeContext({
          userId: 'u1',
          url: '/api/v1/video-projects/studio-current/stage-state',
        }),
      )
      .catch((err: unknown) => {
        const response = (err as ForbiddenException).getResponse() as {
          code?: string;
          message?: string | string[];
        };
        expect(response.code).toBe('ACCOUNT_PENDING');
      });
  });

  it('throws unauthorized when user governance record is missing', async () => {
    const { guard } = setup({ gov: null });
    await expect(
      guard.canActivate(makeContext({ userId: 'u1' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
