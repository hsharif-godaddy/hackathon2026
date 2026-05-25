import type { Stagehand } from '@browserbasehq/stagehand';

import type { Credentials } from '../scenarios/types.js';

export async function handleSignIn(
  stagehand: Stagehand,
  credentials: Credentials
): Promise<void> {
  const page = stagehand.context.pages()[0];
  if (!page) {
    throw new Error('No page available for sign-in');
  }

  console.log('Attempting sign-in...');

  try {
    // Check if we're on a login page or if there's a sign-in form
    const currentUrl = page.url();

    if (currentUrl.includes('login') || currentUrl.includes('sso')) {
      console.log('Sign-in page detected (redirect mode)');
      await stagehand.act(`Enter "${credentials.username}" in the username field`);
      await stagehand.act(`Enter "${credentials.password}" in the password field`);
      await stagehand.act('Click the "Sign In" button');
    } else {
      // Check for sign-in iframe (production mode) using act()
      // Stagehand will handle iframe detection automatically
      console.log('Checking for sign-in form...');
      await stagehand.act(`If there is a sign-in form visible, enter "${credentials.username}" in the username field, then enter "${credentials.password}" in the password field, then click the "Sign In" button. If no sign-in form is visible, do nothing.`);
    }
  } catch (error) {
    console.log('Sign-in handling error:', error);
    throw error;
  }
}

/**
 * Delete oldest sites if total exceeds maxSites limit
 * @param stagehand - Stagehand instance with browser context
 * @param maxSites - Maximum number of sites to keep (default: 80)
 * @returns Number of sites deleted
 */
export async function deleteOldestSitesIfOverLimit(
  stagehand: Stagehand,
  maxSites: number = 80
): Promise<number> {
  console.log(`Checking site count (max: ${maxSites})...`);

  const page = stagehand.context.pages()[0];
  if (!page) {
    console.log('No page available for site cleanup');
    return 0;
  }

  try {
    const result = await page.evaluate(async (limit: number) => {
      try {
        const response = await fetch('/api/sites');
        if (!response.ok) {
          return { error: `Could not fetch sites: ${response.status}`, deletedCount: 0 };
        }

        const sites = await response.json();
        if (!Array.isArray(sites)) {
          return { error: 'Invalid sites response', deletedCount: 0 };
        }

        const siteCount = sites.length;
        if (siteCount <= limit) {
          return { message: `Site count (${siteCount}) is within limit (${limit})`, deletedCount: 0 };
        }

        // Sort by created_at (oldest first)
        const sortedSites = sites.sort((a, b) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        );

        // Delete oldest sites to get under limit
        const toDelete = siteCount - limit;
        const sitesToDelete = sortedSites.slice(0, toDelete);

        let deletedCount = 0;
        const errors: string[] = [];

        for (const site of sitesToDelete) {
          try {
            const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
            if (deleteResponse.ok) {
              deletedCount++;
            } else {
              errors.push(`Failed to delete ${site.id}: ${deleteResponse.status}`);
            }
          } catch (err) {
            errors.push(`Error deleting ${site.id}: ${String(err)}`);
          }
        }

        return { deletedCount, toDelete, total: siteCount, errors };
      } catch (err) {
        return { error: String(err), deletedCount: 0 };
      }
    }, maxSites);

    if ('error' in result && result.error) {
      console.log(`Site cleanup warning: ${result.error}`);
    } else if ('message' in result && result.message) {
      console.log(result.message);
    } else if ('total' in result && result.total !== undefined && result.toDelete !== undefined) {
      console.log(`Deleted ${result.deletedCount}/${result.toDelete} oldest sites (was ${result.total}, now ${result.total - result.deletedCount})`);
      if ('errors' in result && result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
        result.errors.forEach((err: string) => console.log(`  Warning: ${err}`));
      }
    }

    return result.deletedCount || 0;
  } catch (error) {
    console.log(`Site cleanup failed: ${error}`);
    return 0;
  }
}

export async function deleteAllSitesViaAPI(stagehand: Stagehand): Promise<number> {
  console.log('Cleaning up test sites via API...');

  const page = stagehand.context.pages()[0];
  if (!page) {
    console.log('No page available for API cleanup');
    return 0;
  }

  try {
    const result = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/sites');
        if (!response.ok) {
          return { error: `Could not fetch sites: ${response.status}`, deletedCount: 0 };
        }

        const sites = await response.json();
        if (!Array.isArray(sites) || sites.length === 0) {
          return { message: 'No sites found to clean up', deletedCount: 0 };
        }

        let deletedCount = 0;
        const errors: string[] = [];

        for (const site of sites) {
          try {
            const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
            if (deleteResponse.ok) {
              deletedCount++;
            } else {
              errors.push(`Failed to delete ${site.id}: ${deleteResponse.status}`);
            }
          } catch (err) {
            errors.push(`Error deleting ${site.id}: ${String(err)}`);
          }
        }

        return { deletedCount, total: sites.length, errors };
      } catch (err) {
        return { error: String(err), deletedCount: 0 };
      }
    });

    if ('error' in result && result.error) {
      console.log(`API cleanup warning: ${result.error}`);
    } else if ('message' in result && result.message) {
      console.log(result.message);
    } else if ('total' in result) {
      console.log(`API cleanup completed: ${result.deletedCount}/${result.total} sites deleted`);
      if ('errors' in result && result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
        result.errors.forEach((err: string) => console.log(`  Warning: ${err}`));
      }
    }

    return result.deletedCount || 0;
  } catch (error) {
    console.log(`API cleanup failed: ${error}`);
    return 0;
  }
}
