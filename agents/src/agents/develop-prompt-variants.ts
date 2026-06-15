import { basename } from 'node:path'

/**
 * Eval prompt variants for the develop agent.
 *
 * This is the injection plumbing for offline A/Bs: it lets a gosym eval run swap
 * or add a develop-prompt fragment for one build, gated by a profile flag. It is
 * NOT the experiment — the experiment is what gosym does with these variants
 * (paired scenarios, scored outcomes, a delta). This file only decides which
 * bytes go into a single build.
 *
 * Safety contract:
 * - Inert by default. With no flag set the resolution is empty and the prompt is
 *   byte-identical to production.
 * - Fail-closed. If a variant's flag IS set but its file is missing, or a
 *   `replace` variant targets a non-replaceable fragment, resolution throws.
 *   Silent fallback would let a missing variant run as control and report
 *   "no effect", corrupting the trial — the opposite of what an eval wants.
 */
export type EvalPromptVariant = {
  /** Profile flag that activates this variant (e.g. 'develop.coreV2'). */
  flag: string
  /** Markdown file under develop/experiments/ to inject. */
  fileName: string
  /**
   * prepend — inject `fileName` before core.md
   * append  — inject `fileName` after the technical fragments
   * replace — swap the canonical fragment named `target` for `fileName`
   */
  position: 'prepend' | 'append' | 'replace'
  /** Canonical fragment basename this variant replaces; required when position is 'replace'. */
  target?: string
}

/**
 * Canonical fragments a `replace` variant may target. This is the contract: a
 * variant may only replace a fragment in this set. security.md is intentionally
 * excluded — tenant/security constraints must survive verbatim — as are the
 * filesystem template (dynamic), model-conditional behavior prompts, and the
 * feature-flagged prompt-optimization / suggested-response fragments. Keep this
 * in sync with the fragments actually routed through `resolveFragment` in
 * develop-agent.ts.
 */
export const REPLACEABLE_FRAGMENTS: readonly string[] = [
  'core.md',
  'communication.md',
  'handoff.md',
  'backend.md',
  'frontend.md',
  'seo.md',
  'secrets.md',
  'font-theme.md',
]

/**
 * The shipped variants table. `example-arm.md` is a disposable worked example —
 * its profile (`example-develop`) is intentionally NOT registered, so this row
 * is inert in every deployed build. Delete the row and example-arm.md once a
 * real variant exists. See src/prompts/develop/experiments/README.md.
 */
export const EVAL_PROMPT_VARIANTS: readonly EvalPromptVariant[] = [
  { flag: 'develop.exampleArm', fileName: 'example-arm.md', position: 'append' },
]

/** Outcome of resolving the variants table against the active profile. */
export type VariantResolution = {
  /** Variant file paths to inject before core.md. */
  prependPaths: string[]
  /** Variant file paths to inject after the technical fragments. */
  appendPaths: string[]
  /** Canonical fragment basename → variant path, for `replace` variants. */
  replacements: Map<string, string>
  /** Per-flag record of whether the variant actually applied (for the build log). */
  active: Record<string, boolean>
}

export type ResolveVariantsArgs = {
  variants: readonly EvalPromptVariant[]
  /** Whether a variant's flag is set on the active profile (e.g. wraps profileFlag(flag, false)). */
  isFlagSet: (flag: string) => boolean
  /** Resolve a variant fileName to its absolute path under develop/experiments/. */
  resolveVariantPath: (fileName: string) => string
  /** Existence check for a resolved path (e.g. node:fs existsSync). */
  exists: (path: string) => boolean
}

/**
 * Resolve the variants table for one build. Pure aside from the injected
 * `exists` probe. Throws (fail-closed) on a set-but-missing variant file, a
 * `replace` variant with no/invalid target, or a target outside
 * REPLACEABLE_FRAGMENTS. A variant whose flag is not set is recorded false and
 * otherwise ignored.
 */
export function resolveEvalPromptVariants(args: ResolveVariantsArgs): VariantResolution {
  const { variants, isFlagSet, resolveVariantPath, exists } = args
  const resolution: VariantResolution = {
    prependPaths: [],
    appendPaths: [],
    replacements: new Map<string, string>(),
    active: {},
  }

  for (const variant of variants) {
    if (!isFlagSet(variant.flag)) {
      resolution.active[variant.flag] = false
      continue
    }

    const variantPath = resolveVariantPath(variant.fileName)
    if (!exists(variantPath)) {
      throw new Error(
        `eval prompt variant "${variant.flag}" is active but its file is missing: ` +
          `${variant.fileName}. Fail-closed: a missing variant would silently run as ` +
          `control and corrupt the eval.`,
      )
    }

    if (variant.position === 'replace') {
      const target = variant.target
      if (!target) {
        throw new Error(`eval prompt variant "${variant.flag}" uses position 'replace' but has no target fragment.`)
      }
      if (!REPLACEABLE_FRAGMENTS.includes(target)) {
        throw new Error(
          `eval prompt variant "${variant.flag}" targets non-replaceable fragment "${target}". ` +
            `Replaceable: ${REPLACEABLE_FRAGMENTS.join(', ')}.`,
        )
      }
      resolution.replacements.set(target, variantPath)
    } else if (variant.position === 'prepend') {
      resolution.prependPaths.push(variantPath)
    } else {
      resolution.appendPaths.push(variantPath)
    }

    resolution.active[variant.flag] = true
  }

  return resolution
}

/** File basenames injected this build (prepend + append), for the build log. */
export function injectedFileNames(resolution: VariantResolution): string[] {
  return [...resolution.prependPaths, ...resolution.appendPaths].map((p) => basename(p))
}

/** Canonical fragment names replaced this build, for the build log. */
export function replacedFragmentNames(resolution: VariantResolution): string[] {
  return [...resolution.replacements.keys()]
}
