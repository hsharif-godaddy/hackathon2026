import { z } from 'zod';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';

export const getBookingConfigTool: SkillToolDefinition = {
  name: 'getBookingConfig',
  description: 'Returns the payment provider configuration for the online-appointments skill. Payment is handled internally via GoDaddy Commerce — do NOT load stripe.',
  parameters: z.object({}),
  execute: async () => {
    return {
      paymentProvider: 'godaddy-commerce',
      message: 'Online appointments uses GoDaddy Commerce for payment. Do NOT load stripe. Use commerce-one-time-payment skill for payment integration.',
    };
  },
};

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
