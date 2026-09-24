/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 專案網址。空的就用 localStorage，見 src/net/index.ts */
  readonly VITE_SUPABASE_URL?: string
  /** sb_publishable_... 那把（公開的）。絕對不要填 sb_secret_...。 */
  readonly VITE_SUPABASE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** package.json 的 version，建置時由 vite.config.ts 塞進來 */
declare const __APP_VERSION__: string
