/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
  /** Same as app id in preview containers (local-control-plane sets SITE_ID) */
  readonly SITE_ID: string | undefined
  readonly VITE_PARENT_ORIGIN: string | undefined
  readonly VITE_SHOW_DEV_TOOLS: string
  readonly VITE_ENABLE_LEXICAL_EDITOR: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __airoEditModeActive?: boolean
}
