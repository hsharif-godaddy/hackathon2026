import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error - .mjs import of plain ESM script outside the TS rootDir
import { checkSsrSkillTemplateSync, SSR_SKILL_TEMPLATE_PAIRS } from '../../../../scripts/validate-template-sync.mjs';

const SKILL = SSR_SKILL_TEMPLATE_PAIRS[0].skillPath as string;
const V8 = SSR_SKILL_TEMPLATE_PAIRS[0].v8Path as string;

const staged = (content: string | null) => (_p: string) => content;
const head = (content: string | null) => (_p: string) => content;

describe('checkSsrSkillTemplateSync', () => {
  it('returns true when neither path is staged', () => {
    const result = checkSsrSkillTemplateSync([], { readStaged: staged(null), readHead: head(null) });
    expect(result).toBe(true);
  });

  it('returns true when both paths are staged with identical content', () => {
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (_p: string) => 'same content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(true);
  });

  it('returns false when both staged but skill content differs from v8', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (p: string) => p === SKILL ? 'skill content' : 'v8 content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(false);
  });

  it('returns true when only skill path staged and matches head of v8', () => {
    const changes = [{ path: SKILL }];
    const rs = (_p: string) => 'content';
    const rh = (_p: string) => 'content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(true);
  });

  it('returns false when only skill path staged and differs from head of v8', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: SKILL }];
    const rs = (_p: string) => 'new skill content';
    const rh = (_p: string) => 'v8 head content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });

  it('returns true when only v8 path staged and matches head of skill', () => {
    const changes = [{ path: V8 }];
    const rs = (_p: string) => 'content';
    const rh = (_p: string) => 'content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(true);
  });

  it('returns false when only v8 path staged and differs from head of skill', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: V8 }];
    const rs = (_p: string) => 'new v8 content';
    const rh = (_p: string) => 'skill head content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });

  it('skips a pair when either content is null (file missing)', () => {
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (p: string) => p === SKILL ? null : 'v8 content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(true);
  });

  it('checks all pairs and reports all failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = SSR_SKILL_TEMPLATE_PAIRS.map((p: { skillPath: string }) => ({ path: p.skillPath }));
    const rs = (p: string) => `staged:${p}`;
    const rh = (p: string) => `head:${p}`;
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });
});
