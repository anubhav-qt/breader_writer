import { Hono } from 'hono';
import { ModelChoice } from '@writer/shared/protocol';
import { houseStanding } from '../ai/house.ts';
import { saveChoice, settingsFor } from '../ai/settings.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';
import type { Login } from '../lib/login.ts';

const offline = () => new ApiError(503, 'ai_offline', 'The AI is offline, so the model can’t be changed right now.');

export function settingsRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/settings', requireWriter(deps));

  /** The account's settings, with what the house writes for it. */
  async function settingsNow(login: Login) {
    const house = await houseStanding(deps.db, deps.env, login);
    return settingsFor(deps, login.id, house);
  }

  /** The model the account's stories run on, and every model it could pick. */
  r.get('/settings', async (c) => {
    return c.json(await settingsNow(c.var.login));
  });

  /** Picks the model, where it comes from and how hard it thinks: only one the account can pick, at a level it takes. */
  r.put('/settings', async (c) => {
    const choice = parse(ModelChoice, await readJson(c));
    const now = await settingsNow(c.var.login);
    if (!now.models) {
      throw offline();
    }
    const model = now.models.find((info) => info.source === choice.source && info.id === choice.model);
    if (!model) {
      throw new ApiError(400, 'unknown_model', 'That model isn’t one you can pick.');
    }
    if (!model.thinkingLevels.includes(choice.thinking)) {
      throw new ApiError(400, 'unknown_thinking', `${model.name} doesn’t take that thinking level.`);
    }
    await saveChoice(deps.db, c.var.login.id, choice);
    return c.json(await settingsNow(c.var.login));
  });

  return r;
}
