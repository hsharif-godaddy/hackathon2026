export { Panel } from './Panel';
export type { PanelProps } from './Panel';
// Re-exported from `panel-chrome` for back-compat: prior versions of this
// package exported `AiroHeader` and its types from `@airo-ux/pattern-library/surfaces/panel`.
// New consumers should import from `@airo-ux/pattern-library/surfaces/panel-chrome` directly.
export { AiroHeader } from '../panel-chrome';
export type { AiroHeaderProps, AiroHeaderTab } from '../panel-chrome';
