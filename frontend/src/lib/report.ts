import { makeReporter, type Reporter } from '@breader/shared/report';

/*
 * The app's errors go to Sentry when the build sets VITE_SENTRY_DSN (Cloudflare Pages does, see
 * infra/README.md). Only the error and its stack are sent: never book text, keys or file names.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;

let reporter: Reporter | null = null;
if (dsn) {
  try {
    reporter = makeReporter({
      dsn,
      component: 'app',
      platform: 'javascript',
      release: import.meta.env.VITE_RELEASE,
      environment: import.meta.env.MODE,
    });
    window.addEventListener('error', (e) => report(e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => report(e.reason));
  } catch {
    reporter = null;
  }
}

export function report(err: unknown, extra?: Record<string, unknown>) {
  reporter?.capture(err, extra);
}
