import type { Character, Relationship, Side } from '@writer/shared/book';
import { IconTrash } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { sidesInCastOrder } from '@writer/shared/setup';
import { Field } from './Fields';

interface Props {
  relationship: Relationship;
  /** Everyone in the cast, the protagonist first. */
  people: Character[];
  protagonistId: string;
  onChange: (relationship: Relationship) => void;
  onUntie: () => void;
  onClose: () => void;
}

/** A name as it reads inside a sentence, like "How Mara sees Ilse". */
function nameIn(people: Character[], id: string, protagonistId: string): string {
  const person = people.find((someone) => someone.id === id);
  if (!person) {
    return 'someone';
  }
  const name = person.name.trim();
  if (name) {
    return name;
  }
  if (person.id === protagonistId) {
    return 'the one you play';
  }
  return 'someone unnamed';
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isBlank(relationship: Relationship): boolean {
  const sides = [relationship.a, relationship.b];
  const written = sides.some((side) => side.sees || side.hides);
  return !relationship.bond && !written;
}

/**
 * A line in the relationship graph, as a sheet over the page: the bond the two share, then each
 * one's side. Changes apply as they're typed. They come in cast order, the one the owner plays
 * first.
 */
export function RelationshipSheet({ relationship, people, protagonistId, onChange, onUntie, onClose }: Props) {
  const [first, second] = sidesInCastOrder(relationship, people);
  const firstName = nameIn(people, first.id, protagonistId);
  const secondName = nameIn(people, second.id, protagonistId);
  const title = capitalized(`${firstName} and ${secondName}`);

  const setSide = (side: Side) => {
    if (side.id === relationship.a.id) {
      onChange({ ...relationship, a: side });
    } else {
      onChange({ ...relationship, b: side });
    }
  };

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <div className="add sheet">
        <Field
          label="What they are to each other"
          value={relationship.bond}
          placeholder="Sisters, old rivals, married, a debt"
          autoFocus={isBlank(relationship)}
          onChange={(bond) => onChange({ ...relationship, bond })}
        />
        <SideFields side={first} name={firstName} otherName={secondName} onChange={setSide} />
        <SideFields side={second} name={secondName} otherName={firstName} onChange={setSide} />
        <p className="add-found">Only the tie is needed. The story fills in the rest.</p>
        <div className="add-actions sheet-actions">
          <button type="button" className="btn btn-ghost sheet-remove" onClick={onUntie}>
            <IconTrash /> Untie
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

interface SideProps {
  side: Side;
  name: string;
  otherName: string;
  onChange: (side: Side) => void;
}

function SideFields({ side, name, otherName, onChange }: SideProps) {
  return (
    <div className="tie-side">
      <Field
        label={capitalized(`how ${name} sees ${otherName}`)}
        size="long"
        value={side.sees}
        placeholder="What they think and feel about them"
        onChange={(sees) => onChange({ ...side, sees })}
      />
      <Field
        label={capitalized(`what ${name} hides from ${otherName}`)}
        size="long"
        value={side.hides}
        placeholder="Secrets, debts, what they would never say"
        onChange={(hides) => onChange({ ...side, hides })}
      />
    </div>
  );
}
