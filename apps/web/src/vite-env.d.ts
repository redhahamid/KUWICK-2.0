/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Stamped by vite.config.ts at build time — the short commit SHA. */
declare const __BUILD_SHA__: string;
