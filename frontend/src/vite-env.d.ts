/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The writer's API. Unset, it's /writer/api on the app's own address. */
  readonly VITE_API_URL?: string;
  /** Breader's API, where logging in happens. Unset, it's https://api.breader.site. */
  readonly VITE_BREADER_API_URL?: string;
}
