import ProjectDomain from "@/app/develop/components/settings/DomainPanel/ProjectDomain";
import DomainAttach from "@/app/develop/components/settings/DomainPanel/DomainAttach";
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { usePublishForDomain } from './usePublishForDomain';
import { hasBeenPublished } from '@/utils/site';
import { useAppIdFromParams } from "@/app/develop/components/utils";
import { useSiteStore } from "@/stores/useSiteStore";
import WebsiteIcon from '@ux/icon/website';
import Box from "@ux/box";
import { text } from "@ux/text";
import Spinner from "@ux/spinner";
import { useSwitchboard } from "@/hooks/useSwitchboard";

export default function DomainPanel() {
  const { data: isDomainAttachEnabled, isLoading: isDomainAttachLoading } = useSwitchboard('appbuilder-domain-attach');
  const { data: isProjectDomainEnabled, isLoading: isProjectDomainLoading } = useSwitchboard('appbuilder-project-domain');
  
  const currentAppId = useAppIdFromParams();
  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  const isSiteLoading = useSiteStore((state) => {
    if (!currentAppId) return false;
    return state.loading[currentAppId] ?? false;
  });

  const { handlePublish, isPublishDisabled, publishState } = usePublishForDomain(currentAppId, site);
  const isPublished = hasBeenPublished(site);

  if (isDomainAttachLoading || isProjectDomainLoading || isSiteLoading) {
    return (
      <div className='flex flex-col justify-center items-center h-[calc(100vh-40rem)] gap-2'>
        <Spinner size='md'/>
        <text.p>Loading domain settings...</text.p>
      </div>
    );
  }

  // Show single empty state if site hasn't been published yet
  if (!isSiteLoading && !isPublished && (isDomainAttachEnabled || isProjectDomainEnabled)) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<WebsiteIcon width={48} height={48} />}
          title="Publish Your App to Manage Domains"
          description="Your app must be published before you can customize your project domain or add custom domains. Publish your app to unlock domain management features."
          ctaLabel={publishState.isPublishing ? "Publishing..." : "Publish Now"}
          onCtaClick={handlePublish}
          ctaDisabled={isPublishDisabled}
        />
      </Box>
    );
  }

  return (
    <Box gap="lg" className="@container">
      {!isDomainAttachEnabled && !isProjectDomainEnabled && (
        <div>
          <text.h1>Domain</text.h1>
          <text.p>Configure custom domains for your application coming soon.</text.p>
        </div>
      )}
      {isProjectDomainEnabled && <ProjectDomain />}
      {isDomainAttachEnabled && <DomainAttach />}
    </Box>
  )
}
