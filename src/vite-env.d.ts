/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CDN_BASE?: string;
  readonly VITE_CDN_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}