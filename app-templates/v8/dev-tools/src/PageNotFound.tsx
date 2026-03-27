import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { injectDevToolsStyles } from './utils/injectDevToolsStyles';
import { safePostMessage } from './utils/postMessage';
import MessageOverlay from './components/MessageOverlay';
import Button from './components/Button';

/**
 * Send message to parent window to build this page
 *
 * @param path - The path that doesn't exist
 */
const sendBuildPageRequest = (path: string) => {
    console.log('Sending build page request to parent:', path);
    try {
      // Use the secure postMessage utility from dev-tools
      safePostMessage(window.parent, {
        type: 'build-page-request',
        pathToBuild: path
      });
      console.log('Build page request sent to parent window via secure postMessage');
    } catch (err) {
      console.error('Failed to send build page request to parent:', err);
    }
  };

/**
 * Development mode 404 - shows "Build this page" option
 */
function DevelopmentNotFound({ path }: { path: string }) {
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
 * 404 Not Found page component
 *
 * Shows a "Build this page" option to ask Airo to create the page
 * The layout (header/footer) is handled by RootLayout in App.tsx.
 */
export default function NotFoundPage() {
  // Use React Router's useLocation to get current path reactively
  const location = useLocation();

  return <DevelopmentNotFound path={location.pathname} />;
}
