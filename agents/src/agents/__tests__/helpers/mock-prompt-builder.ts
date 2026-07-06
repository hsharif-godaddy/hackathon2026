import type { PromptBuilder } from '@airo/ai-lib'
import { vi, type Mock } from 'vitest'

/**
 * Union of PromptBuilder's public method names, derived from the real type.
 * Because the mock below is typed as `Record<PromptBuilderMethod, Mock>`, adding
 * a new method to PromptBuilder makes this Record fail to typecheck until the
 * mock implements it — turning silent mock/API drift (a runtime "x is not a
 * function" that only surfaces in CI) into a local `pnpm typecheck` error.
 */
type PromptBuilderMethod = {
  [K in keyof PromptBuilder]: PromptBuilder[K] extends (...args: never[]) => unknown ? K : never
}[keyof PromptBuilder]

export interface MockPromptBuilderOptions {
  /** Resolved value of `build()`. Defaults to a generic mock prompt. */
  buildResult?: string
  /** Invoked with each path passed to `file()`, for call-tracking assertions. */
  onFile?: (filePath: string) => void
  /** Invoked with each content passed to `text()`, for call-tracking assertions. */
  onText?: (content: string) => void
}

/**
 * Hermetic, fully-stubbed PromptBuilder for agent unit tests. Every fluent
 * method is a chainable `vi.fn` spy, so tests may assert via
 * `builder.file.mock.calls` / `builder.text.mock.calls` (or the `onFile` /
 * `onText` hooks) without touching the filesystem.
 */
export function createMockPromptBuilder(options: MockPromptBuilderOptions = {}): PromptBuilder {
  const methods: Record<PromptBuilderMethod, Mock> = {
    text: vi.fn((content: string) => {
      options.onText?.(content)
      return builder
    }),
    file: vi.fn((filePath: string) => {
      options.onFile?.(filePath)
      return builder
    }),
    template: vi.fn(() => builder),
    list: vi.fn(() => builder),
    when: vi.fn(() => builder),
    section: vi.fn(() => builder),
    sections: vi.fn(() => builder),
    getSections: vi.fn(() => []),
    clear: vi.fn(() => builder),
    build: vi.fn().mockResolvedValue(options.buildResult ?? '# Mock Prompt'),
  }
  const builder: PromptBuilder = methods as unknown as PromptBuilder
  return builder
}
