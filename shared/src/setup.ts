import { inOrder, pairKey, type BookSetup, type Character, type Relationship, type Side } from './book.ts';

/*
 * Changing a setup: its cast and the relationship graph between them. The setup page changes it
 * this way as the owner types, and so do the changes Procreator suggests, on the page and on the
 * server alike. Each returns a new setup and leaves the one it was given as it was.
 */

/** The setup without this character, and without their relationships. */
export function withoutCharacter(setup: BookSetup, id: string): BookSetup {
  const cast = setup.cast.filter((character) => character.id !== id);
  const relationships = setup.relationships.filter((relationship) => !involves(relationship, id));
  return { ...setup, cast, relationships };
}

function involves(relationship: Relationship, id: string): boolean {
  return relationship.a.id === id || relationship.b.id === id;
}

/** The setup with this character's sheet changed, whether they're the protagonist or in the cast. */
export function withCharacter(setup: BookSetup, changed: Character): BookSetup {
  if (changed.id === setup.protagonist.id) {
    return { ...setup, protagonist: changed };
  }
  const cast = setup.cast.map((character) => {
    if (character.id === changed.id) {
      return changed;
    }
    return character;
  });
  return { ...setup, cast };
}

/* The relationship graph: a line between two people is a bond and each one's side. */

function blankSide(id: string): Side {
  return { id, sees: '', hides: '' };
}

/** A new line between two people, with nothing written on it yet. */
export function blankRelationship(oneId: string, otherId: string): Relationship {
  return inOrder({ bond: '', a: blankSide(oneId), b: blankSide(otherId) });
}

function samePair(relationship: Relationship, key: string): boolean {
  return pairKey(relationship.a.id, relationship.b.id) === key;
}

/** The relationship between these two, if they have one. */
export function findRelationship(setup: BookSetup, oneId: string, otherId: string): Relationship | undefined {
  const key = pairKey(oneId, otherId);
  return setup.relationships.find((relationship) => samePair(relationship, key));
}

/** The setup with this relationship changed, or added if the two had none. */
export function withRelationship(setup: BookSetup, changed: Relationship): BookSetup {
  const key = pairKey(changed.a.id, changed.b.id);
  const known = setup.relationships.some((relationship) => samePair(relationship, key));
  if (!known) {
    return { ...setup, relationships: [...setup.relationships, changed] };
  }
  const relationships = setup.relationships.map((relationship) => {
    if (samePair(relationship, key)) {
      return changed;
    }
    return relationship;
  });
  return { ...setup, relationships };
}

/** A relationship's two sides in cast order, so the one the owner plays always comes first. */
export function sidesInCastOrder(relationship: Relationship, people: Character[]): [Side, Side] {
  const ids = people.map((person) => person.id);
  if (ids.indexOf(relationship.b.id) < ids.indexOf(relationship.a.id)) {
    return [relationship.b, relationship.a];
  }
  return [relationship.a, relationship.b];
}

/** The setup without the line between these two. */
export function withoutRelationship(setup: BookSetup, oneId: string, otherId: string): BookSetup {
  const key = pairKey(oneId, otherId);
  const relationships = setup.relationships.filter((relationship) => !samePair(relationship, key));
  return { ...setup, relationships };
}
