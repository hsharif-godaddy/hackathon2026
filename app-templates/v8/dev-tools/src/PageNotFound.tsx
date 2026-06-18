import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Button from './components/Button';
import MessageOverlay from './components/MessageOverlay';
import {
  PAGE_NOT_FOUND_TITLE,
  formatPageNameFromPathname,
  getPageNotFoundMessage,
} from './page-not-found-copy';
import { send } from './utils/eventBus';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { isOriginAllowed } from './utils/postMessage';

function builderEntryUrl(
  parentOrigin: string | undefined,
  siteId: string | undefined
): string | null {
  const origin = parentOrigin?.trim();
  if (!origin) {
    return null;
  }
  const base = origin.replace(/\/$/, '');
  const id = siteId?.trim();
  if (id) {
    return `${base}/develop/${encodeURIComponent(id)}?siteId=${encodeURIComponent(id)}`;
  }
  return base;
}

const sendBuildPageRequest = (path: string) => {
  try {
    send({
      type: 'build-page-request',
      pathToBuild: path
    });
  } catch (err) {
    console.error('Failed to send build page request to parent:', err);
  }
};

/**
 * 404 for Vite development / preview container only.
 *
 * - Development (embedded in builder iframe): “Build this page” + postMessage to parent.
 * - Preview (standalone tab): explains incomplete preview and points to builder chat.
 *
 * Publish / production builds do not load this module; see `src/routes.tsx` → `pages/_404`.
 */
export default function PageNotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  const isEmbeddedInBuilder = window !== window.top;
  const [isBuilding, setIsBuilding] = React.useState(false);
  const [isAgentProcessing, setIsAgentProcessing] = React.useState(false);

  useEffect(() => {
    injectDevToolsStyles();
  }, []);

  useEffect(() => {
    if (!isEmbeddedInBuilder) return;
    function handleMessage(event: MessageEvent) {
      if (!event.origin || !isOriginAllowed(event)) return;
      if (event.data?.type === 'AGENT_PROCESSING_STATE') {
        const processing = Boolean(event.data.isProcessing);
        setIsAgentProcessing(processing);
        if (!processing) setIsBuilding(false);
      }
    }
    window.addEventListener('message', handleMessage);
    send({ type: 'request-processing-state' });
    return () => window.removeEventListener('message', handleMessage);
  }, [isEmbeddedInBuilder]);

  const handleBuildPage = () => {
    setIsBuilding(true);
    sendBuildPageRequest(location.pathname);
  };

  const builderUrl = builderEntryUrl(
    import.meta.env.VITE_PARENT_ORIGIN,
    import.meta.env.SITE_ID
  );

  const hasAppDeepLink = Boolean(import.meta.env.SITE_ID?.trim());

  const pageName = formatPageNameFromPathname(location.pathname);
  const isBusy = isBuilding || isAgentProcessing;

  const goBackOrHome = function goBackOrHome() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  };

  return (
    <MessageOverlay
      title={PAGE_NOT_FOUND_TITLE}
      message={getPageNotFoundMessage(pageName, isEmbeddedInBuilder && isBusy)}
      button={ isEmbeddedInBuilder ? (
        <>
          <Button
            text="Go Back"
            onClick={goBackOrHome}
            variant="secondary"
          />
          <Button
            text={isBusy ? 'Processing...' : 'Build this page'}
            onClick={handleBuildPage}
            loading={isBusy}
          />
        </>
      ) : (
        builderUrl ? (
          <>
            <Button
              text="Go Back"
              onClick={goBackOrHome}
              variant="secondary"
            />
            <Button
              text={hasAppDeepLink ? 'Open app in builder' : 'Open builder'}
              onClick={() => window.open(builderUrl, '_blank', 'noopener,noreferrer')}
            />
          </>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Open the builder and use chat to ask Airo to build this page.
          </span>
        )
      )
      }
    />
  );
}
