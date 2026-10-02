import type { ReactNode } from 'react';
import { IconPlus } from './icons';
import { Logo } from './Logo';
import './header.css';

interface Props {
  /** How many books, beside the tab's name. */
  count: number;
  /** Starts a new book. No button while the library is empty: it has its own, in the middle. */
  onNew?: () => void;
  /** Log in, or the account's menu. */
  account: ReactNode;
}

/** The logo, the library's one tab, and New book and the account at the right. */
export function Header({ count, onNew, account }: Props) {
  return (
    <header className="hdr">
      <Logo />
      <nav className="tabs" role="tablist" aria-label="Library">
        <button id="tab-mine" role="tab" type="button" className="tab" aria-selected="true" aria-controls="library-mine">
          My books
          <span className="tab-count" aria-hidden="true">{count}</span>
          <span className="sr-only">, {count} {count === 1 ? 'book' : 'books'}</span>
          <span className="tab-line" />
        </button>
      </nav>
      <div className="hdr-actions">
        {onNew && (
          <button type="button" className="btn btn-primary" onClick={onNew} aria-label="New book">
            <IconPlus /> <span className="hdr-label">New book</span>
          </button>
        )}
        {account}
      </div>
    </header>
  );
}
