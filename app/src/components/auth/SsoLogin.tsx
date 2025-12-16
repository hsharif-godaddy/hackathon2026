'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect,useState } from 'react';
import Alert from '@ux/alert';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { getRootDomain } from '@/utils/getRootDomain';

/**
 * Props interface for SsoDeck component
 *
 * Defined manually to avoid static imports from @sso/deck which break SSR
 */
interface SsoDeckComponentProps {
  host: string;
  ssoApp: string;
  ssoPort: string;
  consumingApp: string;
  consumingPath: string;
  consumingPort?: string;
  pageToLoad: string;
  pageToLoadParams?: Record<string, string>;
  onAuth: (data?: unknown) => void;
  onLoad?: () => void;
  autoResize?: boolean;
}

/**
 * Dynamically import SsoDeck with SSR disabled
 *
 * CRITICAL: @sso/deck does not support SSR. ALL imports from this package
 * (including CSS and types) MUST be inside the dynamic import factory function.
 * Any static imports at module level will cause SSR errors.
 */
const SsoDeckDynamic = dynamic<SsoDeckComponentProps>(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@sso/deck/dist/index.css');

    const { SsoDeck } = await import('@sso/deck');

    return {
      default: function SsoDeckWrapper(props: SsoDeckComponentProps) {
        return <SsoDeck {...props} />;
      },
    };
  },
  {
    ssr: false,
  }
);

/**
 * Global SsoDeck wrapper component for in-app SSO authentication
 *
 * This component should be rendered once at the root layout level and controlled
 * via the useAuthUIStore Zustand store.
 */
export default function SsoLogin() {
  const [error, setError] = useState<string | null>(null);
  const [ssoHost, setSsoHost] = useState<string | null>(null);

  const { isSsoLoginOpen, isSsoLoading, closeSsoLogin, setSsoLoaded } = useAuthUIStore();
  const { refreshAuth } = useAuthContext();

  // Determine SSO host on client-side only
  useEffect(function determineSsoHost() {
    setSsoHost(getRootDomain() || 'godaddy.com');
  }, []);

  const handleLoad = useCallback(function onSsoLoad() {
    setSsoLoaded();
  }, [setSsoLoaded]);

  const handleAuth = useCallback(function onSsoAuth(data?: unknown) {
    logger.info('sso-login.auth.success', {
      message: 'SSO authentication successful',
      data,
    });

    setError(null);
    closeSsoLogin();

    // Refresh auth state to pick up new cookies without full page reload
    refreshAuth();
  }, [closeSsoLogin, refreshAuth]);

  // Don't render if not open
  if (!isSsoLoginOpen) {
    return null;
  }

  // Min dimensions sized to fit SsoDeck iframe content and prevent layout shift when loading
  return (
    <Modal
      className='sso-login-modal min-h-[520px] sm:min-h-[620px] min-w-[300px] md:min-w-[600px]'
      title=''
      onClose={closeSsoLogin}
      strategy='fixed'
    >
      <>
        {error && (
          <Alert emphasis='critical' className='mb-4'>
            {error}
          </Alert>
        )}
        <div className='relative w-full pt-2 md:pt-1 min-h-[480px] sm:min-h-[580px]'>
          {(isSsoLoading || !ssoHost) && (
            <div className='absolute inset-0 flex items-center justify-center'>
              <Spinner />
            </div>
          )}
          {ssoHost && (
            <SsoDeckDynamic
              host={ssoHost}
              ssoApp='sso'
              ssoPort=''
              consumingApp='airo-builder'
              consumingPath='/'
              pageToLoad='/login'
              pageToLoadParams={{}}
              onAuth={handleAuth}
              onLoad={handleLoad}
              autoResize
            />
          )}
        </div>
      </>
    </Modal>
  );
}
