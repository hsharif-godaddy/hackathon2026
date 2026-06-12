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
 * Instead of telling users to edit .env files, this tool drives the secrets UI in the
 * builder where the user can save credentials securely.
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
  `Request secrets (API keys, credentials) from the user via the builder secrets UI.
The UI will present a secrets form for the user to enter and save values securely.
Use this instead of telling users to edit .env files directly.

WHEN TO USE:
- User wants to integrate Stripe, OpenAI, Google Maps, AWS, or other external services
- User says "connect me with …", "hook up …", "add my API keys", or "update credentials"
- User asks "how do I add secrets?" or "how do I add API keys?"
- User wants to update an existing API key, including after they closed the form without saving
- Any integration that requires credentials the user must supply

DO NOT use this for:
- System-managed secrets
- Stock photos (Getty/Unsplash) — use the media tool; users do not connect stock-photo accounts

After the user closes the secrets step without saving and later asks to provide or update a key again,
call this tool again with the appropriate secret name and mode — do not assume the form is still visible.

Do not describe where the form appears or tell the user to look in a specific location — the UI handles placement.
Never say the form is "above", "below", "in the chat", or "ready" without calling this tool in the same turn.

The tool returns secretsRequired=true so the UI can show the secrets form.
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
        : 'Secrets form is open. Wait for the user to save and send a confirmation message.',
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
