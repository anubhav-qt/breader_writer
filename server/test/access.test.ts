import { describe, expect, it } from 'vitest';
import { accessFor } from '../src/lib/access.ts';
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
    expect(r.body).toEqual({ account: null, access: 'logged_out' });
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
});
