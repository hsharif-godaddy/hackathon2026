import { useState, useEffect } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import Box from '@ux/box';
import Button from '@ux/button';
import { text } from '@ux/text';
import { MockLoginDialog } from './MockLogin';
import { logImpressionEvent } from '@/utils/instrumentation';

interface UnauthorizedComponentProps {
  unauthorizedMessage?: string;
}

export default function UnauthorizedComponent({
  unauthorizedMessage
}: UnauthorizedComponentProps) {
  const [showMockLogin, setShowMockLogin] = useState(false);

  const { isMockAuth } = useAuthContext();
  const { signIn } = useSsoSignIn();

  useEffect(() => {
    logImpressionEvent('auth.unauthorized.view')();
  }, [])

  return (
    <>
      <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden header-bg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
        <Box className="p-4 max-w-md text-center" gap="lg">
          <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
          { unauthorizedMessage && (
            <p className={`${text.body} mb-3`}>
              {unauthorizedMessage}
            </p>
          )}
          <Button
            onClick={() => {
              signIn({ onShowMockLogin: () => setShowMockLogin(true) });
            }}
            size='sm'
            design='secondary'
            text='Sign In to Continue'
            className="w-full text-white"
          />
        </Box>
      </div>
      {isMockAuth && showMockLogin && (
        <MockLoginDialog
          isOpen={showMockLogin}
          onClose={() => setShowMockLogin(false)}
        />
      )}
    </>
  );
};
