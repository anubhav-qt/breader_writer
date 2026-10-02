/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The laptop's API, e.g. https://api.breader.example. */
  readonly VITE_API_URL?: string;
  /** The fallback's API on Render, e.g. https://fb.breader.example. */
  readonly VITE_API_FALLBACK_URL?: string;
  /** Sentry project DSN; errors aren't reported without it. */
  readonly VITE_SENTRY_DSN?: string;
  /** The commit this build is from (vite.config.ts). */
  readonly VITE_RELEASE?: string;
}
