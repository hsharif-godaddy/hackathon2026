import ProjectDomain from "@/app/develop/components/settings/DomainPanel/ProjectDomain";
import DomainAttach from "@/app/develop/components/settings/DomainPanel/DomainAttach";
import Box from "@ux/box";
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { text } from "@ux/text";

export default function DomainPanel() {
  const { featureFlags } = useSwitchboard();
  const isDomainAttachEnabled = featureFlags['appbuilder-domain-attach'] ?? false;
  const isProjectDomainEnabled = featureFlags['appbuilder-project-domain'] ?? false;

  return (
    <Box gap="xl">
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
