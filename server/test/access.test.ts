import { describe, expect, it } from 'vitest';
import { accessFor, isOwner } from '../src/lib/access.ts';
import { account, address, call, writer } from './helpers.ts';

const login = (email: string, emailVerified: boolean) => ({ id: 'u1', email, name: 'Someone', emailVerified });

describe('who can write', () => {
  it('needs a login, a confirmed address, and a place on the list', () => {
    const list = ['owner@example.com'];
    expect(accessFor(null, list)).toBe('logged_out');
    expect(accessFor(login('owner@example.com', false), list)).toBe('unconfirmed');
    expect(accessFor(login('stranger@example.com', true), list)).toBe('invite_only');
    expect(accessFor(login('owner@example.com', true), list)).toBe('open');
  });

  it('ignores the case of the address', () => {
    expect(accessFor(login('Owner@Example.COM', true), ['owner@example.com'])).toBe('open');
  });

  it('never says whether an unconfirmed address is on the list', () => {
    const list = ['owner@example.com'];
    expect(accessFor(login('owner@example.com', false), list)).toBe(accessFor(login('stranger@example.com', false), list));
  });
});

describe('GET /v1/me', () => {
  it('answers a browser with no login', async () => {
    const r = await call(writer(), 'GET', '/v1/me');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ account: null, access: 'logged_out', owner: false });
  });

  it('tells each account where it stands', async () => {
    const invited = address('invited');
    const unconfirmed = address('unconfirmed');
    const app = writer({ WRITER_EMAILS: [invited, unconfirmed] });

    const open = await call(app, 'GET', '/v1/me', await account(invited, true));
    expect(open.body.access).toBe('open');
    const waiting = await call(app, 'GET', '/v1/me', await account(unconfirmed, false));
    expect(waiting.body.access).toBe('unconfirmed');
    const stranger = await call(app, 'GET', '/v1/me', await account(address('stranger'), true));
    expect(stranger.body.access).toBe('invite_only');
  });

  it('tells the owner they are, and no one else', async () => {
    const owner = address('owner');
    const invited = address('invited');
    const app = writer({ WRITER_EMAILS: [owner, invited], OWNER_EMAILS: [owner] });

    const theirs = await call(app, 'GET', '/v1/me', await account(owner, true));
    expect(theirs.body).toMatchObject({ access: 'open', owner: true });
    const other = await call(app, 'GET', '/v1/me', await account(invited, true));
    expect(other.body).toMatchObject({ access: 'open', owner: false });
  });
});

describe('who manages the AI accounts', () => {
  const env = (writers: string[], owners: string[]) => ({ WRITER_EMAILS: writers, OWNER_EMAILS: owners });

  it('is a writer on the owner list, with a confirmed address', () => {
    const both = env(['owner@example.com'], ['owner@example.com']);
    expect(isOwner(login('owner@example.com', true), both)).toBe(true);
    expect(isOwner(login('Owner@Example.COM', true), both)).toBe(true);
    expect(isOwner(login('owner@example.com', false), both)).toBe(false);
    expect(isOwner(null, both)).toBe(false);
  });

  it('is never someone who can’t write, or a writer off the owner list', () => {
    expect(isOwner(login('owner@example.com', true), env([], ['owner@example.com']))).toBe(false);
    expect(isOwner(login('writer@example.com', true), env(['writer@example.com'], []))).toBe(false);
  });
});
