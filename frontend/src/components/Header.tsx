import type { ReactNode } from 'react';
import { Logo } from './Logo';
import './header.css';

interface Props {
  /** How many books, beside the tab's name. */
  count: number;
  /** Log in, or the account's menu. */
  account: ReactNode;
}

/** The logo, the library's one tab, and the account at the right. */
export function Header({ count, account }: Props) {
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
      <div className="hdr-actions">{account}</div>
    </header>
  );
}
