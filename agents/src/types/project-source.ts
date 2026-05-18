/**
 * Types for project source detection (third-party app builders, etc.)
 */

export type ProjectSourceId = 'lovable';

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
