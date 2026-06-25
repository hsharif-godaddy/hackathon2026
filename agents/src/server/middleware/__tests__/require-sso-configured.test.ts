import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireSsoConfigured } from '../require-sso-configured.js';
import type { AuthenticatedRequest } from '../jwt-auth.js';

const APP_ID = 'abcdefghij';

function makeReq(agentContext?: Partial<AuthenticatedRequest['agentContext']>): Partial<AuthenticatedRequest> {
  return {
    params: { id: APP_ID },
    path: `/apps/${APP_ID}/publish`,
    method: 'POST',
    agentContext: agentContext === undefined
      ? undefined
      : {
          siteId: APP_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ...agentContext,
        } as AuthenticatedRequest['agentContext'],
  };
}

describe('requireSsoConfigured', () => {
  let next: NextFunction;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    res = { status, json };
    next = vi.fn();
  });

  it('passes through when ssoRequired is false (non-ent)', () => {
    const req = makeReq({ ssoRequired: false, ssoConfigured: false });
    requireSsoConfigured(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('passes through when ssoRequired is undefined (legacy token)', () => {
    const req = makeReq({});
    requireSsoConfigured(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through when both required and configured are true', () => {
    const req = makeReq({ ssoRequired: true, ssoConfigured: true });
    requireSsoConfigured(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 sso_not_configured when required but not configured', () => {
    const req = makeReq({ ssoRequired: true, ssoConfigured: false });
    requireSsoConfigured(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    const body = json.mock.calls[0][0];
    expect(body.error).toBe('sso_not_configured');
    expect(body.details).toContain('Settings → SSO');
  });

  it('returns 401 when agentContext is missing (jwtAuthMiddleware did not run)', () => {
    const req = makeReq(undefined);
    requireSsoConfigured(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
