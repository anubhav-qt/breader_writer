import type { Character } from '@writer/shared/book';
import { IconTrash } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Field } from './Fields';

interface Props {
  character: Character;
  /** The one the owner plays, who can't be removed. */
  plays: boolean;
  onChange: (character: Character) => void;
  onRemove: () => void;
  onClose: () => void;
}

type Line = 'name' | 'who' | 'personality' | 'past' | 'notes';

/**
 * A character's sheet, over the page. Changes apply as they're typed. The same sheet opens mid
 * story, to read or change someone (see CLAUDE.md). How they relate to the others is in the
 * relationship graph, not here.
 */
export function CharacterSheet({ character, plays, onChange, onRemove, onClose }: Props) {
  const set = (line: Line, value: string) => {
    onChange({ ...character, [line]: value });
  };

  let title = character.name.trim();
  if (!title && plays) {
    title = 'The one you play';
  } else if (!title) {
    title = 'Someone new';
  }

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <div className="add sheet">
        <Field label="Name" value={character.name} max={80} autoFocus={!character.name} onChange={(v) => set('name', v)} />
        <Field label="Who they are" size="long" value={character.who} placeholder="Their place in the world: work, age, family" onChange={(v) => set('who', v)} />
        <Field label="Personality" size="long" value={character.personality} placeholder="How they act, what they want, what they fear" onChange={(v) => set('personality', v)} />
        <Field label="Past" size="long" value={character.past} placeholder="What happened to them before the story starts" onChange={(v) => set('past', v)} />
        <Field label="Notes" size="notes" value={character.notes} placeholder="Anything else: looks, habits, how they talk" onChange={(v) => set('notes', v)} />
        <p className="add-found">Only the name is needed. The story fills in the rest.</p>
        <div className="add-actions sheet-actions">
          {!plays && (
            <button type="button" className="btn btn-ghost sheet-remove" onClick={onRemove}>
              <IconTrash /> Remove
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
