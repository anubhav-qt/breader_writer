import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ThinkingLevel, type ModelChoice, type ModelInfo, type Settings } from '@writer/shared/protocol';
import { IconCheck, IconChevron } from '../../components/icons';
import { Segmented } from '../../components/Segmented';
import { contextName, fetchSettings, picksThinking, providerName, saveChoice, thinkingName } from '../../data/models';
import { failureText } from '../../lib/api';
import { springs } from '../../lib/springs';
import '../account/account.css';
import '../add/add.css';
import { AccountsSection } from './Accounts';
import { useAccounts, type Accounts } from './useAccounts';
import './models.css';

/** The settings as last heard, or why there are none. */
type Loaded =
  | { state: 'waiting' }
  | { state: 'failed' }
  | { state: 'ready'; settings: Settings };

/**
 * The level a model takes nearest to the one wanted: the same or the next stronger, else the
 * next weaker, as the server moves it.
 */
function nearestLevel(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) {
    return wanted;
  }
  const order = ThinkingLevel.options;
  const at = order.indexOf(wanted);
  for (const level of order.slice(at + 1)) {
    if (levels.includes(level)) {
      return level;
    }
  }
  for (const level of order.slice(0, at).reverse()) {
    if (levels.includes(level)) {
      return level;
    }
  }
  return levels[0] ?? 'off';
}

function modelIn(settings: Settings, id: string): ModelInfo | undefined {
  return settings.models?.find((model) => model.id === id);
}

/** What the chip says: the model and how hard it thinks, or that the AI is offline. */
function chipText(loaded: Loaded): string {
  if (loaded.state === 'waiting') {
    return 'Model';
  }
  if (loaded.state === 'failed' || !loaded.settings.models) {
    return 'AI offline';
  }
  const { using } = loaded.settings;
  const model = modelIn(loaded.settings, using.model);
  const name = model?.name ?? using.model;
  if (!picksThinking(model)) {
    return name;
  }
  return `${name} · ${thinkingName(using.thinking)}`;
}

/**
 * The header's model picker: the model the account's stories run on, and how hard it thinks, for
 * every book. It drops down the models the accounts signed in to Procreator's proxy serve, and
 * for the owner, those accounts, to sign in and out. Built from what the library has: its ghost
 * button, the account menu's dropdown, and breader's segmented control.
 */
export function ModelPicker({ owner }: { owner: boolean }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'waiting' });
  const [message, setMessage] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const settings = await fetchSettings();
      setLoaded({ state: 'ready', settings });
    } catch {
      setLoaded({ state: 'failed' });
    }
  }, []);

  const accounts = useAccounts(owner, open, load);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening it asks again, so a model just signed in shows up.
  useEffect(() => {
    if (!open) {
      setMessage(null);
      return;
    }
    void load();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open, load]);

  /** Shows the choice at once, then keeps what the server answers, or goes back if it says no. */
  const choose = async (settings: Settings, choice: ModelChoice) => {
    setMessage(null);
    setLoaded({ state: 'ready', settings: { ...settings, using: choice } });
    try {
      const saved = await saveChoice(choice);
      setLoaded({ state: 'ready', settings: saved });
    } catch (e) {
      setLoaded({ state: 'ready', settings });
      setMessage(failureText(e));
    }
  };

  const pickModel = (settings: Settings, model: ModelInfo) => {
    // Coming from a model that thinks at its own pace, there's no level to keep: start from high.
    let wanted: ThinkingLevel = 'high';
    if (picksThinking(modelIn(settings, settings.using.model))) {
      wanted = settings.using.thinking;
    }
    const thinking = nearestLevel(model.thinkingLevels, wanted);
    void choose(settings, { model: model.id, thinking });
  };

  const pickThinking = (settings: Settings, thinking: ThinkingLevel) => {
    void choose(settings, { model: settings.using.model, thinking });
  };

  return (
    <div ref={root}>
      <button
        type="button"
        className="btn btn-ghost pick-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`The story’s model: ${chipText(loaded)}`}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{chipText(loaded)}</span>
        <IconChevron />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="acct-menu pick-menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={springs.snappy}
          >
            <Menu
              loaded={loaded}
              message={message}
              owner={owner}
              accounts={accounts}
              onRetry={() => void load()}
              onModel={pickModel}
              onThinking={pickThinking}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MenuProps {
  loaded: Loaded;
  message: string | null;
  owner: boolean;
  accounts: Accounts;
  onRetry: () => void;
  onModel: (settings: Settings, model: ModelInfo) => void;
  onThinking: (settings: Settings, thinking: ThinkingLevel) => void;
}

function Menu({ loaded, message, owner, accounts, onRetry, onModel, onThinking }: MenuProps) {
  if (loaded.state === 'waiting') {
    return <div className="acct-verify">Asking for the models…</div>;
  }
  if (loaded.state === 'failed') {
    return (
      <div className="acct-verify">
        <span>The writer can’t reach its server right now. It comes back by itself.</span>
        <button type="button" className="login-link" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  const { settings } = loaded;
  if (!settings.models) {
    return (
      <div className="acct-verify">
        <span>The AI is offline: Procreator’s proxy can’t be reached. It comes back by itself.</span>
        <button type="button" className="login-link" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  // The owner signs the accounts in and out below the models. While the proxy is offline there's
  // nothing to sign in to, so they wait with the models.
  let accountsPart: ReactNode = null;
  if (owner) {
    accountsPart = (
      <>
        <div className="acct-sep" />
        <AccountsSection accounts={accounts} />
      </>
    );
  }
  if (settings.models.length === 0) {
    return (
      <>
        <div className="acct-verify">No models yet: no AI account is signed in.</div>
        {accountsPart}
      </>
    );
  }

  const current = modelIn(settings, settings.using.model);
  const levels = current?.thinkingLevels ?? [];
  const options = levels.map((level) => ({ v: level, label: thinkingName(level) }));
  return (
    <>
      <div className="clbl" id="pick-models">The story’s model</div>
      <div className="pick-list" role="radiogroup" aria-labelledby="pick-models">
        {settings.models.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            picked={model.id === settings.using.model}
            onPick={() => onModel(settings, model)}
          />
        ))}
      </div>
      {picksThinking(current) && (
        <Segmented
          label="Thinking"
          value={settings.using.thinking}
          options={options}
          onChange={(thinking) => onThinking(settings, thinking)}
        />
      )}
      {!picksThinking(current) && <div className="acct-verify">It thinks at its own pace.</div>}
      {message && <p className="acct-message" role="status">{message}</p>}
      <div className="acct-sep" />
      <div className="acct-verify">For every book.</div>
      {accountsPart}
    </>
  );
}

/** A model, as one of the account menu's items, with what serves it and its context below. */
function ModelRow({ model, picked, onPick }: { model: ModelInfo; picked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={picked} className="acct-item pick-row" onClick={onPick}>
      <span>
        {model.name}
        <small>{providerName(model.provider)} · {contextName(model.contextWindow)} context</small>
      </span>
      {picked && <IconCheck />}
    </button>
  );
}
