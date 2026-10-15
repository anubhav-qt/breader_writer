import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1');

const list = z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().default(8790),
  RELEASE: z.string().default('dev'),

  /**
   * The writer's own tables, in the `writer` schema. In production this is breader's Supabase
   * (its session pooler); locally, the Postgres in infra/compose.dev.yml.
   */
  DATABASE_URL: z.string().min(1),
  /** off for local Docker; require for Supabase. */
  DATABASE_SSL: z.enum(['off', 'require']).default('off'),
  /**
   * Where breader keeps its logins (its users and auth_sessions tables), read only. Unset means
   * DATABASE_URL, as in production, where both are breader's Supabase. Locally it points at prod
   * breader, so a real breader login works here.
   */
  BREADER_DATABASE_URL: z.string().optional(),
  BREADER_DATABASE_SSL: z.enum(['off', 'require']).default('off'),

  /** Breader's SESSION_SECRET. Breader's login cookie is signed with it. */
  SESSION_SECRET: z.string().min(32),
  /** Breader's COOKIE_SECURE. Secure cookies get a __Secure- prefix on their name (lib/login.ts). */
  COOKIE_SECURE: bool.default(true),
  /** The app's addresses, allowed to call this server with the login cookie. */
  ALLOWED_ORIGINS: list.default([]),

  /**
   * Who can write: these accounts, by email, once the address is confirmed. Like breader's
   * SPEECH_EMAILS. Everyone else sees that the writer is invite only.
   */
  WRITER_EMAILS: list.transform((emails) => emails.map((e) => e.toLowerCase())).default([]),
  /**
   * Who signs the proxy's AI accounts in and out, in settings: the owner, by email. Each must be
   * in WRITER_EMAILS too. No one else sees the accounts.
   */
  OWNER_EMAILS: list.transform((emails) => emails.map((e) => e.toLowerCase())).default([]),
  /**
   * Opens the writer to every breader account with a confirmed address (step 9). Those not in
   * WRITER_EMAILS get their first chapter on the owner's AI, and bring their own after it.
   */
  OPEN_TO_ALL: bool.default(false),

  /**
   * The CLIProxyAPI the models come through (see CLAUDE.md): its address, like
   * http://127.0.0.1:8317. Unset means no AI here, and the writer says it's offline.
   */
  CLIPROXY_URL: z.string().optional(),
  /** The key its model endpoints take (one of its `api-keys`). */
  CLIPROXY_API_KEY: z.string().default(''),
  /**
   * Its management API's key: for what it knows about each model (its name, context and thinking
   * levels), and for the owner to sign accounts in and out from settings. Without it the models
   * still work, without thinking levels, and settings can't manage the accounts.
   */
  CLIPROXY_MANAGEMENT_KEY: z.string().default(''),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank line in .env (BREADER_DATABASE_URL=) means "not set".
  const given = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = Env.safeParse(given);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
