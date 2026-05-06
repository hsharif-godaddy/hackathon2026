'use client';

import { useEffect, useRef } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { logger } from '@/lib/request-context';
import { initSsoDebugTools, isSsoDebugEnabled } from '@/lib/sso-debug';

export default function SsoDebugTools() {
  const { authState } = useAuthContext();
  const lastIatRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    initSsoDebugTools();
  }, []);

  useEffect(() => {
    if (!authState) return;

    const typed = authState as {
      payload?: { iat?: number; hbi?: number; exp?: number; per?: boolean };
      authType?: string;
    };
    const payload = typed.payload;
    if (!payload?.iat) return;

    const tokenIat = payload.iat;
    const tokenHbi = payload.hbi;
    const tokenExp = payload.exp;
    const isPersistent = payload.per;
    const authType = typed.authType;

    const isNewIdentity = tokenIat !== lastIatRef.current;
    if (isNewIdentity) {
      logger.clearClientBaseContext();
      lastIatRef.current = tokenIat;
    }

    logger.setClientBaseContext({
      ...(tokenIat !== undefined ? { tokenIat } : {}),
      ...(tokenHbi !== undefined ? { tokenHbi } : {}),
      ...(tokenExp !== undefined ? { tokenExp } : {}),
      ...(isPersistent !== undefined ? { isPersistent } : {}),
      ...(authType ? { authType } : {}),
    });

    if (isSsoDebugEnabled() && isNewIdentity) {
      const now = Date.now() / 1000;
      const iatDate = new Date(tokenIat * 1000);
      const iatAgo = Math.round((now - tokenIat) / 60);
      const lines: string[] = [
        `[__airo.sso] token loaded`,
        `  iat (last login):      ${iatDate.toLocaleString()} (${iatAgo}m ago)`,
      ];
      if (tokenHbi !== undefined) {
        const hbiDate = new Date(tokenHbi * 1000);
        const hbiAgo = Math.round((now - tokenHbi) / 60);
        lines.push(`  hbi (last heartbeat):  ${hbiDate.toLocaleString()} (${hbiAgo}m ago)`);
      }
      if (tokenExp !== undefined) {
        const expiresIn = Math.round((tokenExp - now) / 60);
        const expDate = new Date(tokenExp * 1000);
        lines.push(`  exp (expires):         ${expDate.toLocaleString()} (in ${expiresIn}m)`);
      }
      if (isPersistent !== undefined) lines.push(`  persistent session:    ${isPersistent}`);
      if (authType) lines.push(`  auth type:             ${authType}`);
      console.debug(lines.join('\n'));
    }
  }, [authState]);

  return null;
}
