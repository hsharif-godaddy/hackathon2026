import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import matter from 'gray-matter';

import { Logger } from '../logging/index.js';
import { getFeatures, skills } from '../services/features.js';
import type { PublishEnvContributor } from './types.js';

const logger = Logger.create({ component: 'publish-env-discovery' });
const CONTRIBUTOR_FILENAMES = ['publish-env-contributor.js', 'publish-env-contributor.ts'] as const;

interface PublishEnvContributorModule {
  publishEnvContributor?: unknown;
  default?: unknown;
}

interface SkillFrontmatter {
  name?: string;
  enablementId?: string;
  markets?: string[];
  switchboardFlag?: string;
  allowedAgents?: string[];
}

export interface DiscoverPublishEnvContributorsOptions {
  skillsDir?: string;
  market?: string;
  contextMetadata?: Record<string, unknown>;
  agentId?: string;
}

function defaultSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findContributorModuleInDir(dir: string): Promise<string | null> {
  for (const filename of CONTRIBUTOR_FILENAMES) {
    const candidate = path.join(dir, filename);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function findContributorModules(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const modules: string[] = [];

  const modulePath = await findContributorModuleInDir(dir);
  if (modulePath) {
    modules.push(modulePath);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    modules.push(...await findContributorModules(path.join(dir, entry.name)));
  }

  return modules.sort((a, b) => a.localeCompare(b));
}

function isWithinOrEqual(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === '' || Boolean(relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function findNearestSkillDir(startDir: string, skillsDir: string): Promise<string | null> {
  let current = startDir;
  while (isWithinOrEqual(skillsDir, current)) {
    if (await fileExists(path.join(current, 'skill.md'))) {
      return current;
    }
    if (current === skillsDir) break;
    current = path.dirname(current);
  }
  return null;
}

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

async function readSkillFrontmatter(skillDir: string): Promise<SkillFrontmatter | null> {
  try {
    const skillMd = await readFile(path.join(skillDir, 'skill.md'), 'utf-8');
    const { data } = matter(skillMd);
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      enablementId: typeof data.enablementId === 'string' ? data.enablementId : undefined,
      markets: parseStringArray(data.markets),
      switchboardFlag: typeof data.switchboardFlag === 'string' ? data.switchboardFlag : undefined,
      allowedAgents: parseStringArray(data.allowedAgents),
    };
  } catch (error) {
    logger.warn('publish_env.contributor.frontmatter_read_failed', {
      skillDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function skillNameFromDir(skillDir: string, skillsDir: string, frontmatter: SkillFrontmatter): string {
  return frontmatter.name ?? path.relative(skillsDir, skillDir).split(path.sep).join('/');
}

function isSkillContributorEnabled(
  skillName: string,
  frontmatter: SkillFrontmatter,
  options: DiscoverPublishEnvContributorsOptions
): boolean {
  const { enablementId, markets, switchboardFlag, allowedAgents } = frontmatter;

  if (enablementId) {
    const features = getFeatures();
    if (!(enablementId in features.enabledSkills) && !skills.isProfileGated(enablementId)) {
      logger.warn('publish_env.contributor.unknown_feature_flag', {
        skill: skillName,
        enablementId,
      });
    }

    if (!skills.isEnabled(enablementId)) {
      logger.debug('publish_env.contributor.feature_disabled', {
        skill: skillName,
        enablementId,
      });
      return false;
    }
  }

  if (markets && markets.length > 0) {
    const market = options.market;
    if (!market || !markets.includes(market)) {
      logger.debug('publish_env.contributor.market_restricted', {
        skill: skillName,
        markets,
        requestMarket: market,
      });
      return false;
    }
  }

  if (switchboardFlag && !options.contextMetadata?.[switchboardFlag]) {
    logger.debug('publish_env.contributor.switchboard_disabled', {
      skill: skillName,
      switchboardFlag,
    });
    return false;
  }

  if (allowedAgents && options.agentId && !allowedAgents.includes(options.agentId)) {
    logger.debug('publish_env.contributor.agent_restricted', {
      skill: skillName,
      allowedAgents,
      agentId: options.agentId,
    });
    return false;
  }

  return true;
}

function isPublishEnvContributor(value: unknown): value is PublishEnvContributor {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as PublishEnvContributor).name === 'string'
    && typeof (value as PublishEnvContributor).collect === 'function'
  );
}

async function loadContributor(modulePath: string): Promise<PublishEnvContributor> {
  const mod = await import(pathToFileURL(modulePath).href) as PublishEnvContributorModule;
  const contributor = mod.publishEnvContributor ?? mod.default;
  if (!isPublishEnvContributor(contributor)) {
    throw new Error(`Invalid publish env contributor module: ${modulePath}`);
  }
  return contributor;
}

export async function discoverPublishEnvContributors(
  options: DiscoverPublishEnvContributorsOptions = {}
): Promise<PublishEnvContributor[]> {
  const skillsDir = options.skillsDir ?? defaultSkillsDir();
  const modulePaths = await findContributorModules(skillsDir);
  const contributors: PublishEnvContributor[] = [];

  for (const modulePath of modulePaths) {
    const skillDir = await findNearestSkillDir(path.dirname(modulePath), skillsDir);
    if (!skillDir) {
      logger.warn('publish_env.contributor.no_skill_md', { modulePath });
      continue;
    }

    const frontmatter = await readSkillFrontmatter(skillDir);
    if (!frontmatter) continue;

    const skillName = skillNameFromDir(skillDir, skillsDir, frontmatter);
    if (!isSkillContributorEnabled(skillName, frontmatter, options)) continue;

    contributors.push(await loadContributor(modulePath));
  }

  return contributors;
}
