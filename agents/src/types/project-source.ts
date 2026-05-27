/**
 * Types for project source detection (third-party app builders, etc.)
 */

export type ProjectSourceId = 'lovable' | 'replit' | 'airo' | 'base44';

/** Existence check for a known path relative to the app root. */
export interface PathSignal {
  path: string;
  /** Constrain match to directory (true) or file (false). Omit to match either. */
  isDirectory?: boolean;
}

/** Filename or dirname substring match discovered during the directory walk. */
export interface NamePattern {
  /** Case-insensitive substring to match against the entry name. */
  contains: string;
  /** Only match entries directly inside the app root (default: false = anywhere). */
  rootOnly?: boolean;
  /** Match directory names instead of file names (default: false = files). */
  isDirectory?: boolean;
}

export interface SourceDetector {
  id: ProjectSourceId;
  needles: string[];
  /** Root-relative path existence checks — cheapest signal, run first. */
  pathSignals?: PathSignal[];
  /** Name substring patterns evaluated during the directory walk. */
  namePatterns?: NamePattern[];
}

export interface ProjectSourceMatch {
  source: ProjectSourceId;
  /** Path relative to app root */
  file: string;
  /** 1-based line number when available */
  line?: number;
}

export interface ProjectSourceDetectionResult {
  detectedSources: ProjectSourceId[];
  matches: ProjectSourceMatch[];
  filesScanned: number;
  filesSkippedDueToCap: number;
}

export type ProjectSourceDetectionTrigger = 'zip_import' | 'git_pull';

export interface ProjectSourceDetectionContext {
  appId: string;
  appPath: string;
  jobId: string;
  trigger: ProjectSourceDetectionTrigger;
}
