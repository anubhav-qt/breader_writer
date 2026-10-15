import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AiAccount, Provider, SignIn, SignInStatus } from '@writer/shared/protocol';
import type { Db } from '../../db/client.ts';
import { ownSignIns } from '../../db/schema.ts';
import { log } from '../../log.ts';
import { cancelSignIn, finishSignIn, listAccounts, setPrefix, signInStatus, signOut, startSignIn } from '../accounts.ts';
import { ProxyError, type Proxy } from '../proxy.ts';

/*
 * A writer's own subscriptions (step 9), signed in to the writers' proxy: a CLIProxyAPI apart from
 * the house's, which the API runs beside itself (writers_proxy.ts). Each writer's sign-ins carry a
 * prefix of theirs, and that proxy forces prefixes (force-model-prefix), so a call for
 * `<prefix>/<model>` reaches only that writer's sign-ins: one writer's never serves another's calls.
 *
 * The proxy doesn't say which credential a sign-in made, so one sign-in runs at a time on the
 * server, and whatever is there that nobody owns once it's done is that writer's. Before a
 * sign-in starts, anything nobody owns is signed out, so nothing left over is taken for anyone's.
 */

/** The proxy waits 5 minutes for a sign-in; after a little more, another writer can start one. */
const WAIT_MS = 6 * 60_000;

/** A writer's prefix on the writers' proxy, made from their account, the same every time. */
export function prefixFor(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex');
  return `w${hash.slice(0, 16)}`;
}

/** Another writer is signing in, and only one can at a time. */
export class SignInBusy extends Error {
  constructor() {
    super('Someone else is signing in right now. Try again in a minute or two.');
    this.name = 'SignInBusy';
  }
}

interface Pending {
  state: string;
  userId: string;
  at: number;
}

export class WritersSignIns {
  readonly proxy: Proxy;
  private pending: Pending | null = null;

  constructor(proxy: Proxy) {
    this.proxy = proxy;
  }

  /** The sign-in waiting, or null when none is, or it has waited too long. */
  private waiting(): Pending | null {
    const pending = this.pending;
    if (pending && Date.now() - pending.at > WAIT_MS) {
      this.pending = null;
    }
    return this.pending;
  }

  /** Whether the sign-in with this state is the account's own, and still waiting. */
  isTheirs(userId: string, state: string): boolean {
    const pending = this.waiting();
    if (!pending) {
      return false;
    }
    return pending.userId === userId && pending.state === state;
  }

  /** The names of every sign-in some writer owns. */
  private async ownedNames(db: Db): Promise<Set<string>> {
    const rows = await db.select({ name: ownSignIns.name }).from(ownSignIns);
    return new Set(rows.map((row) => row.name));
  }

  /** Signs out whatever nobody owns: a sign-in that finished while nobody was asking after it. */
  private async dropUnowned(db: Db) {
    const owned = await this.ownedNames(db);
    const accounts = await listAccounts(this.proxy);
    for (const account of accounts) {
      if (!owned.has(account.id)) {
        log.warn({ name: account.id }, 'signing out a sign-in on the writers’ proxy that nobody owns');
        await signOut(this.proxy, account.id);
      }
    }
  }

  /** Starts a sign-in for the account. Throws SignInBusy while another writer's waits. */
  async start(db: Db, userId: string, provider: Provider): Promise<SignIn> {
    const pending = this.waiting();
    if (pending && pending.userId !== userId) {
      throw new SignInBusy();
    }
    if (pending) {
      await cancelSignIn(this.proxy, pending.state).catch(() => undefined);
      this.pending = null;
    }
    await this.dropUnowned(db);
    const signIn = await startSignIn(this.proxy, provider);
    this.pending = { state: signIn.state, userId, at: Date.now() };
    return signIn;
  }

  /** Every sign-in that appeared with the account's, now the account's: given its prefix, and kept as its own. */
  private async claim(db: Db, userId: string) {
    const owned = await this.ownedNames(db);
    const accounts = await listAccounts(this.proxy);
    const prefix = prefixFor(userId);
    for (const account of accounts) {
      if (owned.has(account.id)) {
        continue;
      }
      await setPrefix(this.proxy, account.id, prefix);
      await db.insert(ownSignIns).values({ name: account.id, userId, provider: account.provider, email: account.name }).onConflictDoNothing();
    }
  }

  /** How the account's sign-in stands; once it's done, what it made becomes the account's. */
  async status(db: Db, userId: string, state: string): Promise<SignInStatus> {
    const status = await signInStatus(this.proxy, state);
    if (status.status === 'ok') {
      await this.claim(db, userId);
      this.pending = null;
    }
    if (status.status === 'error') {
      this.pending = null;
    }
    return status;
  }

  /** Hands the proxy the address the sign-in ended on. */
  async finish(state: string, address: string): Promise<void> {
    await finishSignIn(this.proxy, state, address);
  }

  async cancel(state: string): Promise<void> {
    this.pending = null;
    await cancelSignIn(this.proxy, state);
  }

  /**
   * The account's sign-ins as settings show them. While the proxy can't be reached, they're
   * listed as kept, each saying so.
   */
  async list(db: Db, userId: string): Promise<AiAccount[]> {
    const rows = await db.select().from(ownSignIns).where(eq(ownSignIns.userId, userId));
    if (rows.length === 0) {
      return [];
    }
    const names = new Set(rows.map((row) => row.name));
    try {
      const accounts = await listAccounts(this.proxy);
      return accounts.filter((account) => names.has(account.id));
    } catch (err) {
      if (!(err instanceof ProxyError)) {
        throw err;
      }
      const problem = 'The writers’ proxy can’t be reached right now.';
      return rows.map((row) => ({ id: row.name, provider: row.provider, name: row.email || row.name, problem }));
    }
  }

  /** The providers the account has signed in, for a proxy that lists models without prefixes. */
  async providersOf(db: Db, userId: string): Promise<Set<string>> {
    const rows = await db.select({ provider: ownSignIns.provider }).from(ownSignIns).where(eq(ownSignIns.userId, userId));
    return new Set(rows.map((row) => row.provider));
  }

  /** Signs one of the account's own out. Answers false when it isn't theirs. */
  async signOut(db: Db, userId: string, name: string): Promise<boolean> {
    const [row] = await db
      .select()
      .from(ownSignIns)
      .where(and(eq(ownSignIns.userId, userId), eq(ownSignIns.name, name)));
    if (!row) {
      return false;
    }
    try {
      await signOut(this.proxy, name);
    } catch (err) {
      // Gone from the proxy already is signed out.
      const gone = err instanceof ProxyError && err.status === 404;
      if (!gone) {
        throw err;
      }
    }
    await db.delete(ownSignIns).where(eq(ownSignIns.name, name));
    return true;
  }
}
