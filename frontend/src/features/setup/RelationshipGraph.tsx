import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { motion } from 'motion/react';
import { RELATIONSHIP_LIMIT, pairKey, type Character, type Relationship } from '@writer/shared/book';
import { sidesInCastOrder } from '../../data/setup';
import { springs } from '../../lib/springs';
import { layOut, type Box, type Dot, type Point } from './graphLayout';

interface Props {
  /** Everyone in the cast, the protagonist first. */
  people: Character[];
  protagonistId: string;
  relationships: Relationship[];
  /** Opens the line between two people, tying them first if they aren't yet. */
  onOpen: (oneId: string, otherId: string) => void;
}

/** The longest bond shown on a line; the rest is on the relationship's sheet. */
const BOND_SHOWN = 28;
/** The graph never grows taller than this, however big the cast. */
const MOST_HEIGHT = 760;

/** A person's name as the graph draws it. */
function nameOf(person: Character, protagonistId: string): string {
  const name = person.name.trim();
  if (name) {
    return name;
  }
  if (person.id === protagonistId) {
    return 'You';
  }
  return 'No name yet';
}

function useWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const box = ref.current;
    if (!box) {
      return;
    }
    // Measured once now, so the graph is drawn on the first frame, then again whenever it changes.
    setWidth(Math.round(box.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The graph grows taller with the cast, faster on a phone, where there's less room across. */
function heightFor(width: number, count: number): number {
  let height = 420;
  let perPerson = 18;
  if (width < 520) {
    height = 360;
    perPerson = 28;
  }
  const extra = Math.max(0, count - 8) * perPerson;
  return Math.min(height + extra, MOST_HEIGHT);
}

function shortBond(bond: string): string {
  if (bond.length <= BOND_SHOWN) {
    return bond;
  }
  return `${bond.slice(0, BOND_SHOWN - 1).trimEnd()}…`;
}

/** What the layout depends on, as one string, so it's only laid out again when that changes. */
interface Shape {
  dots: Dot[];
  pairs: [string, string][];
  box: Box;
}

function layoutFor(shape: string, before: Map<string, Point>): Map<string, Point> {
  const { dots, pairs, box } = JSON.parse(shape) as Shape;
  if (box.width === 0) {
    return new Map();
  }
  return layOut(dots, pairs, box, before);
}

/** Enter and Space press a dot or a line, as they would a button. */
function onPress(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };
}

/**
 * The relationship graph: everyone as a dot, and a line for each relationship. Tap two people to
 * tie them, or a line to open it (see CLAUDE.md). It's the one place relationships show, in setup
 * and mid story.
 */
export function RelationshipGraph({ people, protagonistId, relationships, onOpen }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const height = heightFor(width, people.length);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The line under the pointer or keyboard focus, by its pair key, to show its bond.
  const [pointed, setPointed] = useState<string | null>(null);
  const placed = useRef(new Map<string, Point>());

  const dots: Dot[] = people.map((person) => ({ id: person.id, label: nameOf(person, protagonistId) }));
  const pairs: [string, string][] = relationships.map((relationship) => [relationship.a.id, relationship.b.id]);
  // The layout only moves when who's in the graph, their names, the lines or the box change, not
  // when a relationship's words do. It starts from where everyone was last time.
  const shape: Shape = { dots, pairs, box: { width, height } };
  const shapeKey = JSON.stringify(shape);
  const places = useMemo(() => layoutFor(shapeKey, placed.current), [shapeKey]);
  useEffect(() => {
    placed.current = places;
  }, [places]);

  const names = new Map(dots.map((dot) => [dot.id, dot.label]));
  const tied = new Set(pairs.map(([one, other]) => pairKey(one, other)));
  // Someone picked who has since left the cast is let go.
  let pick = picked;
  if (pick && !names.has(pick)) {
    pick = null;
  }

  const tap = (id: string) => {
    setNote(null);
    if (!pick) {
      setPicked(id);
      return;
    }
    if (pick === id) {
      setPicked(null);
      return;
    }
    const full = relationships.length >= RELATIONSHIP_LIMIT;
    if (!tied.has(pairKey(pick, id)) && full) {
      setNote(`A book can have ${RELATIONSHIP_LIMIT} relationships at most.`);
      return;
    }
    setPicked(null);
    onOpen(pick, id);
  };

  let hint = 'Tap two people to tie them, or a line to open it.';
  if (people.length < 2) {
    hint = 'Add someone to the cast, then tie people together here.';
  } else if (note) {
    hint = note;
  } else if (pick) {
    const name = names.get(pick);
    hint = `Tap someone to tie to ${name}, or ${name} again to let go.`;
  } else if (relationships.length === 0) {
    hint = 'Tap two people to tie them.';
  }

  let svgClass = 'graph-svg';
  if (pick) {
    svgClass += ' is-picking';
  }

  const drawn: Drawn[] = [];
  for (const relationship of relationships) {
    const from = places.get(relationship.a.id);
    const to = places.get(relationship.b.id);
    if (!from || !to) {
      continue;
    }
    const key = pairKey(relationship.a.id, relationship.b.id);
    const [first, second] = sidesInCastOrder(relationship, people);
    const touchesPick = pick === relationship.a.id || pick === relationship.b.id;
    drawn.push({
      key,
      relationship,
      from,
      to,
      label: `${names.get(first.id)} and ${names.get(second.id)}`,
      lit: touchesPick || pointed === key,
    });
  }
  // Bonds are drawn last, over the names, for the lines that are lit.
  const bonds = drawn.filter((line) => line.lit && line.relationship.bond);

  return (
    <div className="graph-wrap">
      <div className="graph" ref={boxRef} style={{ height }}>
        {width > 0 && (
          <svg
            className={svgClass}
            width={width}
            height={height}
            viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
            onClick={() => setPicked(null)}
          >
            <g>
              {drawn.map((line) => (
                <Line
                  key={line.key}
                  line={line}
                  onPoint={(on) => setPointed(on ? line.key : null)}
                  onOpen={() => onOpen(line.relationship.a.id, line.relationship.b.id)}
                />
              ))}
            </g>
            <g>
              {people.map((person) => {
                const place = places.get(person.id);
                if (!place) {
                  return null;
                }
                const isPicked = pick === person.id;
                const isPartner = pick !== null && tied.has(pairKey(pick, person.id));
                return (
                  <Person
                    key={person.id}
                    place={place}
                    name={names.get(person.id) ?? ''}
                    plays={person.id === protagonistId}
                    picked={isPicked}
                    lit={isPicked || isPartner}
                    onTap={() => tap(person.id)}
                  />
                );
              })}
            </g>
            <g>
              {bonds.map((line) => (
                <Bond key={line.key} line={line} />
              ))}
            </g>
          </svg>
        )}
      </div>
      <p className="setup-hint graph-hint" aria-live="polite">{hint}</p>
    </div>
  );
}

/** A relationship as the graph draws it. */
interface Drawn {
  key: string;
  relationship: Relationship;
  from: Point;
  to: Point;
  /** The two names, in cast order. */
  label: string;
  /** Whether it's one of the picked person's lines, or under the pointer. */
  lit: boolean;
}

function middleOf(line: Drawn): Point {
  return { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 };
}

interface LineProps {
  line: Drawn;
  /** The pointer or keyboard focus came onto the line (true) or left it (false). */
  onPoint: (on: boolean) => void;
  onOpen: () => void;
}

function Line({ line, onPoint, onOpen }: LineProps) {
  const ends = { x1: line.from.x, y1: line.from.y, x2: line.to.x, y2: line.to.y };
  let className = 'graph-line';
  if (line.lit) {
    className += ' is-lit';
  }
  let ariaLabel = line.label;
  if (line.relationship.bond) {
    ariaLabel += `: ${line.relationship.bond}`;
  }
  return (
    <g
      className={className}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={onPress(onOpen)}
      onMouseEnter={() => onPoint(true)}
      onMouseLeave={() => onPoint(false)}
      onFocus={() => onPoint(true)}
      onBlur={() => onPoint(false)}
    >
      <motion.line className="graph-line-hit" initial={false} animate={ends} transition={springs.smooth} />
      <motion.line className="graph-line-ink" initial={false} animate={ends} transition={springs.smooth} />
    </g>
  );
}

/** What two people are to each other, written over the middle of their line. */
function Bond({ line }: { line: Drawn }) {
  const middle = middleOf(line);
  return (
    <motion.g initial={false} animate={{ x: middle.x, y: middle.y }} transition={springs.smooth}>
      <text className="graph-bond" textAnchor="middle" dy="0.35em">{shortBond(line.relationship.bond)}</text>
    </motion.g>
  );
}

interface PersonProps {
  place: Point;
  name: string;
  plays: boolean;
  picked: boolean;
  /** Whether they're picked, or tied to whoever is. */
  lit: boolean;
  onTap: () => void;
}

function Person({ place, name, plays, picked, lit, onTap }: PersonProps) {
  let className = 'graph-person';
  if (plays) {
    className += ' is-you';
  }
  if (picked) {
    className += ' is-picked';
  }
  if (lit) {
    className += ' is-lit';
  }
  let dot = 6;
  if (plays) {
    dot = 8;
  }
  let ariaLabel = name;
  if (plays) {
    ariaLabel += ', who you play';
  }
  return (
    <motion.g
      className={className}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={picked}
      initial={false}
      animate={{ x: place.x, y: place.y }}
      transition={springs.smooth}
      onClick={(event) => {
        event.stopPropagation();
        onTap();
      }}
      onKeyDown={onPress(onTap)}
    >
      <circle className="graph-hit" r={24} />
      <circle className="graph-ring" r={dot + 6} />
      <circle className="graph-dot" r={dot} />
      <text className="graph-name" textAnchor="middle" y={dot + 22}>{name}</text>
    </motion.g>
  );
}
