import { useId } from 'react';
import { LONG_LIMIT, NOTES_LIMIT, SHORT_LIMIT } from '@writer/shared/book';
import type { FieldRef } from '@writer/shared/suggestions';
import type { Choice } from '../../data/setup';
import { useGhost } from './useGhost';

/*
 * The setup page's fields, in breader's Add a book look (features/add/add.css): a label over a
 * text box, and radio cards for a choice.
 */

/** How much a field holds: a line, a paragraph, or a notes box. */
type Size = 'line' | 'long' | 'notes';

const LIMITS: Record<Size, number> = { line: SHORT_LIMIT, long: LONG_LIMIT, notes: NOTES_LIMIT };

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  size?: Size;
  placeholder?: string;
  /** Fewer characters than the size allows, like a name's. */
  max?: number;
  autoFocus?: boolean;
  className?: string;
  /** Which field of the setup this is, for Procreator's suggestion in it (see useGhost). */
  field?: FieldRef;
}

export function Field({ label, value, onChange, size = 'line', placeholder, max, autoFocus, className, field }: FieldProps) {
  const id = useId();
  let limit = LIMITS[size];
  if (max !== undefined) {
    limit = max;
  }
  const ghost = useGhost(field, value, limit, onChange);

  const changed = (next: string) => {
    ghost.typed();
    onChange(next);
  };
  // The placeholder would show through the faint text.
  let hint = placeholder;
  if (ghost.shown) {
    hint = undefined;
  }

  let input;
  // The mirror the faint text is drawn in takes the field's own look, so its text lines up.
  let mirrorClass;
  if (size === 'line') {
    let inputClass = 'add-input';
    if (className) {
      inputClass += ` ${className}`;
    }
    mirrorClass = inputClass;
    input = (
      <input
        ref={ghost.boxRef}
        id={id}
        className={inputClass}
        value={value}
        placeholder={hint}
        maxLength={limit}
        autoFocus={autoFocus}
        onChange={(e) => changed(e.target.value)}
        {...ghost.boxProps}
      />
    );
  } else {
    mirrorClass = 'add-text';
    input = (
      <textarea
        ref={ghost.boxRef}
        id={id}
        className={`add-text setup-text is-${size}`}
        value={value}
        placeholder={hint}
        maxLength={limit}
        autoFocus={autoFocus}
        onChange={(e) => changed(e.target.value)}
        {...ghost.boxProps}
      />
    );
  }

  let mirror = null;
  if (ghost.shown) {
    mirror = (
      <div ref={ghost.mirrorRef} className={`${mirrorClass} ghost-mirror`} aria-hidden="true">
        <span>{value}</span>
        <span className="ghost-text" {...ghost.ghostProps}>{ghost.shown}</span>
      </div>
    );
  }

  return (
    <div className="setup-field">
      <label className="add-label" htmlFor={id}>{label}</label>
      {/* Always wrapped, so the field isn't made anew when faint text comes and goes. */}
      <div className="ghost-wrap">
        {input}
        {mirror}
      </div>
    </div>
  );
}

interface ChoicesProps<T extends string> {
  label: string;
  choices: Choice<T>[];
  value: T;
  onPick: (id: T) => void;
  /** A line under a choice, like a suggestion. */
  notes?: Partial<Record<T, string>>;
}

/** One of a few, as breader's radio cards. */
export function Choices<T extends string>({ label, choices, value, onPick, notes }: ChoicesProps<T>) {
  const id = useId();
  return (
    <div className="setup-field">
      <div className="add-label" id={id}>{label}</div>
      <div className="add-choices setup-choices" role="radiogroup" aria-labelledby={id}>
        {choices.map((choice) => {
          const on = choice.id === value;
          let className = 'add-choice';
          if (on) {
            className += ' is-on';
          }
          let note = null;
          if (notes) {
            note = notes[choice.id];
          }
          return (
            <button key={choice.id} type="button" role="radio" aria-checked={on} className={className} onClick={() => onPick(choice.id)}>
              <span>
                <b>{choice.name}</b>
                <span>{choice.about}</span>
                {note && <em className="setup-suggest">{note}</em>}
              </span>
              <i className="add-radio" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
