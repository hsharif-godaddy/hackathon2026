import { isDevSupervisorNotFound } from '../../../services/DevSupervisorClient.js';
import type { WorkspaceFiles } from '../../../workspace/index.js';

// Workspace-relative paths for inbox files
export const WIDGET_PATH = 'src/components/InboxChatWidget.tsx';
export const WIDGET_CONFIG_PATH = 'src/lib/inboxChat.config.json';
export const CONTACT_FORM_CONFIG_PATH = 'src/lib/contact-form.config.json';
export const CONTACT_FORM_ROUTE_PATH = 'src/server/api/contact/[formName]/POST.ts';

export async function wsFileExists(files: WorkspaceFiles, path: string): Promise<boolean> {
  const result = await files.stat({ paths: [path] });
  const entry = result.entries[0];
  return !!entry && !('error' in entry && entry.error);
}

export async function wsReadFile(files: WorkspaceFiles, path: string): Promise<string | null> {
  try {
    return await files.readText({ path });
  } catch (err: unknown) {
    if (isDevSupervisorNotFound(err)) return null;
    throw err;
  }
}

export interface ContactFormEntry {
  brandId: string;
  categoryId: number | string;
  overrideEmail?: string;
}

export interface ContactFormConfig {
  forms: Record<string, ContactFormEntry>;
}

export async function readContactFormConfig(files: WorkspaceFiles): Promise<ContactFormConfig> {
  const content: string | null = await wsReadFile(files, CONTACT_FORM_CONFIG_PATH);
  if (!content) return { forms: {} };
  try {
    return JSON.parse(content) as ContactFormConfig;
  } catch {
    throw new Error(`${CONTACT_FORM_CONFIG_PATH} is corrupted and could not be parsed — delete it and re-run.`);
  }
}

export async function writeContactFormConfig(files: WorkspaceFiles, config: ContactFormConfig): Promise<void> {
  const json: string = JSON.stringify(config, null, 2) + '\n';
  await files.write({ path: CONTACT_FORM_CONFIG_PATH, content: json });
}
