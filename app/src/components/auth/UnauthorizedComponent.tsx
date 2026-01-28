import { useEffect,useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import { text } from '@ux/text';

import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { useTranslations } from '@/hooks/useTranslations';
import { logImpressionEvent } from '@/utils/instrumentation';
import { MockLoginDialog } from './MockLogin';

interface UnauthorizedComponentProps {
  unauthorizedMessage?: string;
}

export default function UnauthorizedComponent({
  unauthorizedMessage
}: UnauthorizedComponentProps) {
  const t = useTranslations();
  const [showMockLogin, setShowMockLogin] = useState(false);

  const { isMockAuth } = useAuthContext();
  const { signIn } = useSsoSignIn();

  useEffect(() => {
    logImpressionEvent('auth.unauthorized.view')();
  }, [])

  return (
    <>
      <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
        <Box className="p-4 max-w-md text-center" gap="lg">
          <h2 className="text-xl font-semibold mb-2">{t('build_auth_unauthorized_required')}</h2>
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
            text={t('builder_auth_unauthorized_signin')}
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
