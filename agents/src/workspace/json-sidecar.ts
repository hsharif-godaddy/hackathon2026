import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
import type { WorkspaceFiles } from './files.js';

export interface ReadJsonSidecarOptions<T> {
  files: WorkspaceFiles;
  path: string;
  fallback: T;
  validate?: (parsed: unknown) => T | null | undefined;
  onMalformed?: (error: SyntaxError) => T;
}

export async function readJsonSidecar<T>(options: ReadJsonSidecarOptions<T>): Promise<T> {
  const { files, path, fallback, validate, onMalformed } = options;
  try {
    const content: string = await files.readText({ path });
    const parsed: unknown = JSON.parse(content);
    if (validate) {
      const validated: T | null | undefined = validate(parsed);
      return validated ?? fallback;
    }
    return parsed as T;
  } catch (error: unknown) {
    if (isDevSupervisorNotFound(error)) {
      return fallback;
    }
    if (error instanceof SyntaxError) {
      return onMalformed ? onMalformed(error) : fallback;
    }
    throw error;
  }
}
