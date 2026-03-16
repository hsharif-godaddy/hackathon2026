import type { SkillHooks } from '@airo/ai-lib';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';

export const hooks: SkillHooks = {
  onInstall: async ({ appPath }) => {
    if (appPath) {
      ensureViteResolveDedupe(appPath);
    }
  },
};
