import { useId } from 'react';
import type { Choice } from '../../data/setup';

/*
 * The setup page's fields, in breader's Add a book look (features/add/add.css): a label over a
 * text box, and radio cards for a choice.
 */

/** How much a field holds: a line, a paragraph, or a notes box. */
type Size = 'line' | 'long' | 'notes';

const LIMITS: Record<Size, number> = { line: 200, long: 4000, notes: 20000 };

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
}

export function Field({ label, value, onChange, size = 'line', placeholder, max, autoFocus, className }: FieldProps) {
  const id = useId();
  let limit = LIMITS[size];
  if (max !== undefined) {
    limit = max;
  }

  let input;
  if (size === 'line') {
    let inputClass = 'add-input';
    if (className) {
      inputClass += ` ${className}`;
    }
    input = (
      <input
        id={id}
        className={inputClass}
        value={value}
        placeholder={placeholder}
        maxLength={limit}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    input = (
      <textarea
        id={id}
        className={`add-text setup-text is-${size}`}
        value={value}
        placeholder={placeholder}
        maxLength={limit}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="setup-field">
      <label className="add-label" htmlFor={id}>{label}</label>
      {input}
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
