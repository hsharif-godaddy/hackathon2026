import { useQuery } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';

interface MatchingProjectData {
  projects: any[];
  totalCount: number;
  billingId?: string;
}

interface UseMatchingProjectResult {
  data: MatchingProjectData | null | undefined;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useMatchingProject = (): UseMatchingProjectResult => {
  return useQuery({
    queryKey: ['matching-project'],
    queryFn: async (): Promise<MatchingProjectData | null> => {
      logger.info('matching-project.query.start');

      let allProjects: any[] = [];
      let hasNextPage = true;
      let endCursor: string | null = null;

      // Keep fetching pages until no more pages or we find a matching project
      while (hasNextPage) {
        const url = endCursor
          ? `/api/projects?after=${encodeURIComponent(endCursor)}`
          : '/api/projects';

        const response = await fetch(url, {
          credentials: 'include',
        });

        if (!response.ok) {
          const errorMessage = `Failed to fetch projects: ${response.status}`;
          logger.error('matching-project.query.error', {
            statusCode: response.status,
            error: errorMessage
          });
          throw new Error(errorMessage);
        }

        const data = await response.json();

        if (!data.success || !data.data?.projects?.edges) {
          const errorMessage = data.error || 'Failed to get projects';
          logger.error('matching-project.query.failed', {
            error: errorMessage
          });
          throw new Error(errorMessage);
        }

        const currentPageProjects = data.data.projects.edges;
        allProjects = allProjects.concat(currentPageProjects);

        // Check if any project in current page matches the criteria
        const matchingProject = currentPageProjects.find((edge: any) => {
          const node = edge.node;
          return node.group === 'aigeneratedmedia' &&
                 node.status === 'ACTIVE' &&
                 node.billing?.plan === 'logoImage';
        });

        // If we found a matching project, return it
        if (matchingProject) {
          logger.info('matching-project.query.found', {
            projectId: matchingProject.node.id,
            billingId: matchingProject.node.billing?.id
          });
          return {
            projects: [matchingProject],
            totalCount: 1,
            billingId: matchingProject.node.billing?.id
          } as MatchingProjectData;
        }

        // Update pagination info
        const pageInfo = data.data.projects.pageInfo;
        hasNextPage = pageInfo?.hasNextPage || false;
        endCursor = pageInfo?.endCursor || null;
      }

      // If we checked all pages and found no matching projects
      logger.info('matching-project.query.not-found');
      return null;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes - project data changes less frequently
    gcTime: 5 * 60 * 1000,   // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors (client errors)
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 2; // Retry fewer times since this is a complex paginated operation
    },
    retryDelay: attemptIndex => Math.min(2000 * 2 ** attemptIndex, 15000),
  });
};
