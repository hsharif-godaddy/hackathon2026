// Root re-export surface for `@airo-ux/pattern-library`.
//
// Consumers are encouraged to import from the specific subpath
// (`@airo-ux/pattern-library/chat/thinker`) for the smallest bundle, but the flat
// surface is useful for prototyping and for tools that don't understand
// subpath exports yet.

export * from './chat';
export * from './input';
export * from './primitives';
export * from './surfaces';
// Temporary vendor — see src/_vendor/AGENTS.md. Drop this line when the
// upstream component lands in @godaddy/antares.
export * from './_vendor';
