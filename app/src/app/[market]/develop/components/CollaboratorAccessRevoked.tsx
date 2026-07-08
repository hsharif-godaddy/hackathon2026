'use client';

import { useRouter } from 'next/navigation';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

export function CollaboratorAccessRevoked(): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-intents-ux-box-backgroundColor/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-lg bg-intents-ux-box-backgroundColor p-6 shadow-lg max-w-md text-center">
        <text.h3>
          {t('builder_collaborator_access_revoked_title', undefined, 'Access revoked')}
        </text.h3>
        <text.p>
          {t(
            'builder_collaborator_access_revoked_description',
            undefined,
            'Your access to this app has been revoked by the owner.'
          )}
        </text.p>
        <Button
          design="primary"
          text={t('builder_collaborator_access_revoked_cta', undefined, 'Go to my apps')}
          onClick={() => router.push('/apps')}
          data-testid="access-revoked-redirect"
        />
      </div>
    </div>
  );
}
