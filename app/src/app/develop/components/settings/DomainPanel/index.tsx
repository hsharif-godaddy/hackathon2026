import ProjectDomain from "@/app/develop/components/settings/DomainPanel/ProjectDomain";
import DomainAttach from "@/app/develop/components/settings/DomainPanel/DomainAttach";
import Box from "@ux/box";
import { text } from "@ux/text";
import Spinner from "@ux/spinner";
import { useSwitchboard } from "@/hooks/useSwitchboard";

export default function DomainPanel() {
  const { data: isDomainAttachEnabled, isLoading: isDomainAttachLoading } = useSwitchboard('appbuilder-domain-attach');
  const { data: isProjectDomainEnabled, isLoading: isProjectDomainLoading } = useSwitchboard('appbuilder-project-domain');

  if (isDomainAttachLoading || isProjectDomainLoading) {
    return (
      <div className='flex justify-center items-center h-[calc(100vh-40rem)]'>
        <Spinner size='lg'/>
      </div>
    );
  }

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
