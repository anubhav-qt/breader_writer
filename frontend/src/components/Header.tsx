import type { KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { springs } from '../lib/springs';
import { IconKey, IconPlus } from './icons';
import { Logo } from './Logo';
import './header.css';

export type Tab = 'mine' | 'shelf';

interface Props {
  tab: Tab;
  counts: Record<Tab, number>;
  /** False while the open tab is empty: the empty library has its own centred Add button. */
  canAdd: boolean;
  onTab: (t: Tab) => void;
  onAdd: () => void;
  onKey: () => void;
  /** Log in, or the account's menu. */
  account: ReactNode;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'mine', label: 'My books' },
  { id: 'shelf', label: 'Shared Library' },
];

export function Header({ tab, counts, canAdd, onTab, onAdd, onKey, account }: Props) {
  // One Tab stop for both tabs; the arrow keys switch between them.
  const onArrow = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length].id;
    onTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <header className="hdr">
      <Logo />
      <nav className="tabs" role="tablist" aria-label="Library" onKeyDown={onArrow}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`library-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
          >
            {t.label}
            <span className="tab-count" aria-hidden="true">{counts[t.id]}</span>
            <span className="sr-only">, {counts[t.id]} {counts[t.id] === 1 ? 'book' : 'books'}</span>
            {tab === t.id && <motion.span className="tab-line" layoutId="tab-line" transition={springs.snappy} />}
          </button>
        ))}
      </nav>
      <div className="hdr-actions">
        {/* Not animated: a fading copy would sit beside the empty library's own Add button,
            and on phones that fade can stall and leave both on screen. */}
        {canAdd && (
          <button type="button" className="btn btn-primary" onClick={onAdd} aria-label="Add book">
            <IconPlus /> <span className="hdr-label">Add book</span>
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onKey} title="Library key" aria-label="Library key">
          <IconKey /> <span className="hdr-label">Key</span>
        </button>
        {account}
      </div>
    </header>
  );
}
