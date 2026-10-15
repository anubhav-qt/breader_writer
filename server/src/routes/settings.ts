import { Hono } from 'hono';
import { ModelChoice, type ModelInfo } from '@writer/shared/protocol';
import { houseStanding } from '../ai/house.ts';
import { ProxyError } from '../ai/proxy.ts';
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
    return settingsFor(deps.db, deps.catalog, login.id, house);
  }

  /** The model the account's stories run on, and every model it could pick. */
  r.get('/settings', async (c) => {
    return c.json(await settingsNow(c.var.login));
  });

  /** Picks the model and how hard it thinks. Only a model an account serves, at a level it takes. */
  r.put('/settings', async (c) => {
    const choice = parse(ModelChoice, await readJson(c));
    if (!deps.catalog) {
      throw offline();
    }
    let models: ModelInfo[];
    try {
      models = await deps.catalog.infos();
    } catch (err) {
      if (err instanceof ProxyError) {
        throw offline();
      }
      throw err;
    }
    const model = models.find((info) => info.id === choice.model);
    if (!model) {
      throw new ApiError(400, 'unknown_model', 'No signed in account serves that model.');
    }
    if (!model.thinkingLevels.includes(choice.thinking)) {
      throw new ApiError(400, 'unknown_thinking', `${model.name} doesn’t take that thinking level.`);
    }
    await saveChoice(deps.db, c.var.login.id, choice);
    return c.json(await settingsNow(c.var.login));
  });

  return r;
}
