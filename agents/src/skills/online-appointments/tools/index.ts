import type { SkillHooks } from '@airo/ai-skills';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';

// The appointments UI renders React components (date picker, booking form).
// Skills that install npm packages may pull in transitive deps that bundle
// their own React copy, causing dual-instance crashes. Dedupe proactively.
export const hooks: SkillHooks = {
  onInstall: async ({ appPath }) => {
    if (appPath) {
      ensureViteResolveDedupe(appPath);
    }
  },
};
