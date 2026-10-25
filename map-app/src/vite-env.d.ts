/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_API_URL?: string;
  readonly VITE_AUTH_URL?: string;
  readonly VITE_THUNDERFOREST_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
