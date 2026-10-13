import { useState } from 'react';
import { PREVIEW_MODES, type PreviewMode } from '../data/preview';
import { readLocal, writeLocal } from '../lib/store';
import { IconClose } from './icons';
import './preview-bar.css';

export type AppTheme = 'auto' | 'light' | 'dark';

/** Whether the bar is tucked away into a small circle, kept so a reload leaves it that way. */
const TUCKED_KEY = 'writer.previewBar.v1';

interface Props {
  mode: PreviewMode;
  onMode: (m: PreviewMode) => void;
  theme: AppTheme;
  onTheme: (t: AppTheme) => void;
}

/** Development only: switch between real data, placeholder libraries and notes, and force a theme. */
export function PreviewBar({ mode, onMode, theme, onTheme }: Props) {
  const [tucked, setTucked] = useState(() => readLocal(TUCKED_KEY, false));

  const tuck = (next: boolean) => {
    setTucked(next);
    writeLocal(TUCKED_KEY, next);
  };

  // Tucked, it's a small circle in the corner, so it covers nothing on the page.
  if (tucked) {
    return <button type="button" className="pv pv-dot" aria-label="Show the preview bar" onClick={() => tuck(false)} />;
  }

  return (
    <div className="pv" role="group" aria-label="Preview controls">
      <span className="pv-tag">preview</span>
      {PREVIEW_MODES.map((m) => (
        <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => onMode(m.id)}>
          {m.label}
        </button>
      ))}
      <span className="pv-sep" />
      {(['auto', 'light', 'dark'] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => onTheme(t)}>
          {t}
        </button>
      ))}
      <span className="pv-sep" />
      <button type="button" className="pv-tuck" aria-label="Tuck the preview bar away" onClick={() => tuck(true)}>
        <IconClose />
      </button>
    </div>
  );
}
