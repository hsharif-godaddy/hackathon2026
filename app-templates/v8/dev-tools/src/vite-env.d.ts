/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:media-versions' {
  export function getVersions(): Record<string, string>;
  export function onVersionsUpdate(cb: (versions: Record<string, string>) => void): () => void;
}
