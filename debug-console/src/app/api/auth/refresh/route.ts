import { NextRequest, NextResponse } from 'next/server';

import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from '@/lib/logger';
import { getSsoHost } from '@/lib/sso-host';

/**
 * Refreshes the SSO jomax session by calling SSO's ui_heartbeat endpoint.
 * SSO responds with a fresh Set-Cookie for `auth_jomax`; we forward those
 * cookies back to the browser so the session extends transparently.
 *
 * gd-auth's built-in fetchHeartbeat parses the JSON body but drops Set-Cookie,
 * which is why we call SSO directly here instead of reusing it.
 */
export async function POST(request: NextRequest) {
    const token = gdAuthService.extractTokenFromRequest(request);

    if (!token) {
        return NextResponse.json(
            { ok: false, reason: 'No authentication token found' },
            { status: 401 }
        );
    }

    // Catches malformed or tampered tokens before contacting SSO. Expiration
    // is NOT checked here: gd-auth runs at level 0 for jomax and does not
    // evaluate `iat`/VAT, so stale-but-well-formed tokens still reach SSO —
    // which is the authority on session freshness anyway.
    const validation = await gdAuthService.authenticate(token, request);
    if (!validation.valid) {
        return NextResponse.json(
            { ok: false, reason: validation.reason || 'Invalid token' },
            { status: 401 }
        );
    }

    const ssoHost = getSsoHost(request.headers.get('host'));
    const heartbeatUrl = `https://${ssoHost}/v1/api/token/ui_heartbeat`;

    try {
        const ssoResponse = await fetch(heartbeatUrl, {
            method: 'POST',
            headers: {
                Authorization: `sso-jwt ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ realm: 'jomax' }),
            redirect: 'manual'
        });

        if (ssoResponse.status === 401 || ssoResponse.status === 403) {
            logger.info('auth.refresh.ssoHeartbeat.rejected', {
                status: ssoResponse.status,
                heartbeatUrl
            });
            return NextResponse.json(
                { ok: false, reason: `SSO heartbeat returned ${ssoResponse.status}` },
                { status: 401 }
            );
        }

        if (!ssoResponse.ok) {
            logger.warn('auth.refresh.ssoHeartbeat.nonOk', {
                status: ssoResponse.status,
                heartbeatUrl
            });
            return NextResponse.json(
                { ok: false, reason: `SSO heartbeat returned ${ssoResponse.status}` },
                { status: 502 }
            );
        }

        if (typeof ssoResponse.headers.getSetCookie !== 'function') {
            logger.error('auth.refresh.ssoHeartbeat.noGetSetCookie', {
                message: 'Runtime Headers API is missing getSetCookie; cannot forward refreshed cookie'
            });
            return NextResponse.json(
                { ok: false, reason: 'Server runtime cannot forward refreshed cookie' },
                { status: 500 }
            );
        }

        const setCookies = ssoResponse.headers.getSetCookie();
        if (setCookies.length === 0) {
            // 200 without Set-Cookie means SSO accepted the request but did not
            // rotate our cookie — the session is a ghost. Surface this as 401
            // so the client flips sessionStale rather than silently retrying.
            logger.warn('auth.refresh.ssoHeartbeat.noCookies', {
                status: ssoResponse.status,
                heartbeatUrl
            });
            return NextResponse.json(
                { ok: false, reason: 'SSO returned no Set-Cookie' },
                { status: 401 }
            );
        }

        const response = NextResponse.json({ ok: true }, { status: 200 });
        for (const cookie of setCookies) {
            response.headers.append('set-cookie', cookie);
        }

        logger.info('auth.refresh.ssoHeartbeat.success', {
            cookieCount: setCookies.length
        });
        return response;
    } catch (error) {
        logger.error('auth.refresh.ssoHeartbeat.error', {
            message: 'Failed to refresh SSO session'
        }, { error: error as Error });
        return NextResponse.json(
            { ok: false, reason: 'SSO heartbeat request failed' },
            { status: 502 }
        );
    }
}
