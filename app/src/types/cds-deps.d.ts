declare module '@cds/deps-esm' {
  const deps: Record<string, unknown>
  export default deps
}

declare module '*/cds/deps-esm.js' {
  const deps: Record<string, unknown>
  export default deps
}
