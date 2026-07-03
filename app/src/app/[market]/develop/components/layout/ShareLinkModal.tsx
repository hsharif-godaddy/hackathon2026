'use client';

import { ShareLinkContent } from '@/app/[market]/develop/components/layout/ShareLink';
import ProjectsActionModal from '@/app/[market]/projects/components/ProjectsActionModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/control-plane/types';

interface ShareLinkModalProps {
  site: SiteInfo;
  onClose: () => void;
  location?: string;
}

/**
 * Renders the shared Share Link experience (Published/Preview tabs, URL copy,
 * QR code) inside a modal so it can be reused outside the develop header
 * popover (e.g. the Projects page card kebab menu).
 */
export default function ShareLinkModal({ site, onClose, location = 'projects' }: ShareLinkModalProps) {
  const t = useTranslations();
  const isMobile = useIsMobile();

  return (
    <ProjectsActionModal
      title={t('builder_social_share')}
      onClose={onClose}
      testId="share-link-modal"
      applyAiroTheme={false}
    >
      <div className="w-full min-w-0 md:w-[360px]">
        <ShareLinkContent
          appId={site.id}
          site={site}
          isMobile={isMobile}
          open
          location={location}
        />
      </div>
    </ProjectsActionModal>
  );
}
