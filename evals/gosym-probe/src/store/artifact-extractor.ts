import { basename } from 'node:path';
import type { Turn } from '../runner/transcript.js';
import type {
  ArtifactEntry,
  StoredArtifactManifest,
} from './types.js';

export interface ExtractedArtifact {
  filename: string;
  content: string;
  entry: ArtifactEntry;
}

const MIN_CONFIG_LENGTH = 200;

export function extractArtifacts(turns: Turn[]): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  for (
    let turnIndex = 0;
    turnIndex < turns.length;
    turnIndex++
  ) {
    const turn = turns[turnIndex];
    for (const tc of turn.toolCalls) {
      const index = artifacts.length;
      const artifact = tryExtract(tc, index, turnIndex);
      if (artifact !== null) artifacts.push(artifact);
    }
  }

  return artifacts;
}

export function buildArtifactManifest(
  artifacts: ExtractedArtifact[],
): StoredArtifactManifest {
  return {
    artifacts: artifacts.map((a) => a.entry),
    totalCount: artifacts.length,
  };
}

function tryExtract(
  tc: Turn['toolCalls'][number],
  index: number,
  turnIndex: number,
): ExtractedArtifact | null {
  switch (tc.name) {
    case 'readFile':
      return extractReadFile(tc, index, turnIndex);
    case 'handoff':
      return extractHandoff(tc, index, turnIndex);
    case 'fontTheme':
    case 'colorScheme':
      return extractConfig(tc, index, turnIndex);
    default:
      return null;
  }
}

function extractReadFile(
  tc: Turn['toolCalls'][number],
  index: number,
  turnIndex: number,
): ExtractedArtifact | null {
  if (tc.output === undefined || tc.output === null) return null;

  const inputPath = getInputPath(tc.input);
  const rawName =
    inputPath !== null ? basename(inputPath) : 'readFile.txt';
  const filename = `${index}-${rawName}`;
  const content = stripLineNumbers(String(tc.output));

  return {
    filename,
    content,
    entry: makeEntry(
      index, turnIndex, tc.name, filename, tc.agentId,
    ),
  };
}

/**
 * Extract handoff prompt from tool call input.
 *
 * Note: Legacy eval transcripts captured before 2026-05-18 stored the prompt
 * on `tc.output` instead of `tc.input`. Those transcripts will extract zero
 * handoff artifacts after this change. Regenerate baselines if needed.
 */
function extractHandoff(
  tc: Turn['toolCalls'][number],
  index: number,
  turnIndex: number,
): ExtractedArtifact | null {
  if (tc.input === undefined || tc.input === null) return null;

  const prompt = resolveHandoffPrompt(tc.input);
  if (prompt === null) return null;

  const filename = `${index}-handoff-prompt.txt`;
  return {
    filename,
    content: prompt,
    entry: makeEntry(
      index, turnIndex, tc.name, filename, tc.agentId,
    ),
  };
}

function resolveHandoffPrompt(toolCallInput: unknown): string | null {
  if (typeof toolCallInput === 'object' && toolCallInput !== null) {
    const obj = toolCallInput as Record<string, unknown>;
    return typeof obj.prompt === 'string' ? obj.prompt : null;
  }

  if (typeof toolCallInput === 'string') {
    try {
      const parsed = JSON.parse(toolCallInput) as Record<string, unknown>;
      return typeof parsed.prompt === 'string' ? parsed.prompt : null;
    } catch {
      return null;
    }
  }

  return null;
}

function extractConfig(
  tc: Turn['toolCalls'][number],
  index: number,
  turnIndex: number,
): ExtractedArtifact | null {
  if (tc.output === undefined || tc.output === null) return null;

  const content =
    typeof tc.output === 'string'
      ? tc.output
      : JSON.stringify(tc.output, null, 2);

  if (content.length <= MIN_CONFIG_LENGTH) return null;

  const filename = `${index}-${tc.name}.json`;
  return {
    filename,
    content,
    entry: makeEntry(
      index, turnIndex, tc.name, filename, tc.agentId,
    ),
  };
}

function getInputPath(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.file_path === 'string') return rec.file_path;
  if (typeof rec.path === 'string') return rec.path;
  return null;
}

function makeEntry(
  index: number,
  turnIndex: number,
  toolName: string,
  filename: string,
  agentId: string | undefined,
): ArtifactEntry {
  return {
    index,
    turnIndex,
    toolName,
    filename,
    ...(agentId !== undefined && { agentId }),
  };
}

function stripLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
}
