import type { ReactNode } from 'react';
import './segmented.css';

/* Breader's segmented control, from its reader's settings (features/reader/Panels.tsx). */

export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  /** `muted`: not ready yet. It looks off, and a tap still reaches onChange, which says why. */
  options: Array<{ v: T; label: string; content?: ReactNode; muted?: boolean }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ctl">
      <div className="clbl">{label}</div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            aria-disabled={o.muted || undefined}
            aria-label={o.content ? o.label : undefined}
            title={o.content ? o.label : undefined}
            className={value === o.v ? 'is-on' : o.muted ? 'is-muted' : ''}
            onClick={() => onChange(o.v)}
          >
            {o.content ?? o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
