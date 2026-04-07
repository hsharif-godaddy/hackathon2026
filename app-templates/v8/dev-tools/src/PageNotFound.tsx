import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { safePostMessage } from './utils/postMessage';
import MessageOverlay from './components/MessageOverlay';
import Button from './components/Button';

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
    safePostMessage(window.parent, {
      type: 'build-page-request',
      pathToBuild: path
    });
  } catch (err) {
    console.error('Failed to send build page request to parent:', err);
  }
};

/**
 * Development mode — preview is embedded in the builder iframe.
 * Offers “Build this page” to send a postMessage to the parent so the user can ask Airo in chat.
 */
function DevelopmentModeNotFound({ path }: { path: string }) {
  const navigate = useNavigate();
  const [isBuilding, setIsBuilding] = React.useState(false);

  useEffect(() => {
    injectDevToolsStyles();
  }, []);

  const handleBuildPage = () => {
    setIsBuilding(true);
    sendBuildPageRequest(path);
  };

  return (
    <MessageOverlay
      title="Page doesn't exist"
      message={`The page "${path}" hasn't been created yet.`}
      button={
        <>
          <Button
            text="Go Back"
            onClick={() => navigate(-1)}
            variant="secondary"
          />
          <Button
            text={isBuilding ? "Processing..." : "Build this page"}
            onClick={handleBuildPage}
            loading={isBuilding}
          />
        </>
      }
    />
  );
}

/**
 * Preview mode — user opened the preview URL in its own tab (not inside the builder).
 * No postMessage target; direct them to development/chat in the builder.
 */
function PreviewModeNotFound({ path }: { path: string }) {
  useEffect(() => {
    injectDevToolsStyles();
  }, []);

  const builderUrl = builderEntryUrl(
    import.meta.env.VITE_PARENT_ORIGIN,
    import.meta.env.SITE_ID
  );
  const hasAppDeepLink = Boolean(import.meta.env.SITE_ID?.trim());

  return (
    <MessageOverlay
      title="Preview of an incomplete page"
      message={
        `You are looking at a preview of an incomplete page (${path}).\n\n` +
        'Go to development / chat mode in the builder to view this app and ask Airo to build this page.'
      }
      button={
        builderUrl ? (
          <Button
            text={hasAppDeepLink ? 'Open app in builder' : 'Open builder'}
            onClick={() => window.open(builderUrl, '_blank', 'noopener,noreferrer')}
          />
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
            Open the builder and use chat to ask Airo to build this page.
          </span>
        )
      }
    />
  );
}

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
  const isEmbeddedInBuilder = window !== window.top;

  return isEmbeddedInBuilder
    ? <DevelopmentModeNotFound path={location.pathname} />
    : <PreviewModeNotFound path={location.pathname} />;
}
