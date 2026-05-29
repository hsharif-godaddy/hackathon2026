import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';

/**
 * Secret definition schema for the tool input
 */
const SecretDefinitionSchema = z.object({
  name: z.string().describe('The secret name (e.g., STRIPE_SECRET_KEY)'),
  description: z.string().optional().describe('Help text explaining what this secret is for'),
  required: z.boolean().optional().describe('Whether this secret is required'),
  isExisting: z.boolean().optional().describe('True if updating an existing secret'),
  defaultValue: z.string().optional().describe('Pre-filled value. Use "auto:hex64" to auto-generate a 64-char hex string, "auto:hex32" for 32-char, or "auto:uuid" for UUID.'),
});

/**
 * Request Secrets Tool for AI-Lib
 *
 * Use this tool when you need API keys or secrets from the user for integrations
 * like Stripe, OpenAI, Google Maps, etc.
 *
 * Instead of telling users to edit .env files, this tool displays an inline form
 * in the chat where users can securely add or update secrets.
 *
 * The secrets are stored securely via the Secrets management system and are
 * available to the application at runtime.
 *
 * @example Add secrets for Stripe integration:
 * requestSecrets({
 *   title: 'Stripe API Keys Required',
 *   description: 'To enable payments, we need your Stripe API keys.',
 *   secrets: [
 *     { name: 'STRIPE_SECRET_KEY', description: 'Secret key from Stripe Dashboard', required: true },
 *     { name: 'STRIPE_PUBLISHABLE_KEY', description: 'Publishable key (starts with pk_)', required: true }
 *   ],
 *   mode: 'add'
 * })
 *
 * @example Update an existing secret:
 * requestSecrets({
 *   title: 'Update Secret',
 *   description: 'Enter the new value for your OpenAI API key.',
 *   secrets: [{ name: 'OPENAI_API_KEY', isExisting: true, required: true }],
 *   mode: 'update'
 * })
 *
 * @example Let user add any secrets:
 * requestSecrets({
 *   title: 'Add Secrets',
 *   description: 'Add secrets to your application.',
 *   secrets: [],
 *   mode: 'add',
 *   allowMultiple: true
 * })
 */
export const requestSecrets: Tool = createTool(
  `Request secrets (API keys, credentials) from the user via an inline form in the chat.
Use this instead of telling users to edit .env files directly.

WHEN TO USE:
- User wants to integrate Stripe, OpenAI, Google Maps, or other external services
- User asks "how do I add secrets?" or "how do I add API keys?"
- User wants to update an existing API key
- Any integration that requires credentials

DO NOT use this for:
- System-managed secrets

The tool returns secretsRequired=true and displays a form for the user to fill in.
After the user saves secrets, they will send a message confirming completion.`,

  z.object({
    title: z.string().describe('Title for the secrets form (e.g., "Stripe API Keys Required")'),
    description: z.string().describe('Description explaining why these secrets are needed'),
    secrets: z.array(SecretDefinitionSchema).describe('Array of secret definitions. Empty array for open-ended addition.'),
    mode: z.enum(['add', 'update']).describe('"add" for new secrets, "update" for existing secrets'),
    allowMultiple: z.boolean().optional().default(false).describe('Allow user to add more secrets beyond the predefined list'),
    showSettingsLink: z.boolean().optional().default(true).describe('Show link to Settings → Secrets for full management'),
    autoSubmit: z.boolean().optional().default(false).describe('Auto-save secrets with auto-generated defaults (auto:hex64 etc.) without showing the form. Use when all secrets have auto: defaultValues and no user input is needed.'),
    existingSecretNames: z.array(z.string()).optional().describe('List of existing secret names from app context. Used for validation - prevents duplicates in add mode, restricts choices in update mode.'),
  }),

  async (input, context) => {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for secrets operations');
    }

    // Return the secrets request payload for the frontend to render
    return {
      success: true,
      secretsRequired: true,
      message: input.autoSubmit
        ? 'Secrets are being auto-generated. The user will confirm when ready.'
        : 'Please fill in the secrets form and click Save. Let me know when you are done.',
      secretsRequest: {
        type: 'secrets_request',
        title: input.title,
        description: input.description,
        secrets: input.secrets,
        mode: input.mode,
        allowMultiple: input.allowMultiple ?? false,
        showSettingsLink: input.showSettingsLink ?? true,
        autoSubmit: input.autoSubmit ?? false,
        existingSecretNames: input.existingSecretNames ?? [],
      },
    };
  }
);
