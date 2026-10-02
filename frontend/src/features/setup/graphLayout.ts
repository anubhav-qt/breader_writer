import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

/*
 * Where each person sits in the relationship graph. People who are tied pull together and
 * everyone pushes everyone else away, so the web sorts itself into its groups, inside the box.
 * The box is centred on 0,0.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Dot {
  id: string;
  /** The name under the dot, which the layout keeps clear of the others. */
  label: string;
}

export interface Box {
  width: number;
  height: number;
}

interface Node extends SimulationNodeDatum {
  id: string;
  radius: number;
}

type Link = SimulationLinkDatum<Node>;

/** How far a dot's name reaches below it, and above it for the dot itself. */
const BELOW = 44;
const ABOVE = 16;
/** Room kept free at the edges of the box. */
const EDGE = 14;
const TICKS = 300;

/** About how wide a name is drawn, in Dongle at the graph's size. */
function labelWidth(label: string): number {
  return label.length * 10 + 16;
}

function nodeFor(dot: Dot, before: Map<string, Point>): Node {
  const node: Node = { id: dot.id, radius: labelWidth(dot.label) / 2 + 8 };
  const placed = before.get(dot.id);
  if (placed) {
    node.x = placed.x;
    node.y = placed.y;
  }
  return node;
}

/** Someone new starts beside the first person they're tied to, if that person is placed. */
function placeNewcomers(nodes: Node[], pairs: [string, string][], before: Map<string, Point>) {
  for (const node of nodes) {
    if (node.x !== undefined) {
      continue;
    }
    for (const [one, other] of pairs) {
      let partner: string | null = null;
      if (one === node.id) {
        partner = other;
      } else if (other === node.id) {
        partner = one;
      }
      const near = partner ? before.get(partner) : undefined;
      if (near) {
        node.x = near.x + 40;
        node.y = near.y + 40;
        break;
      }
    }
  }
}

/** How hard the layout moves: a little when everyone is already placed, fully the first time. */
function startingHeat(nodes: Node[], before: Map<string, Point>): number {
  let placed = 0;
  for (const node of nodes) {
    if (before.has(node.id)) {
      placed += 1;
    }
  }
  if (placed === 0) {
    return 1;
  }
  if (placed === nodes.length) {
    return 0.3;
  }
  return 0.6;
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) {
    return (low + high) / 2;
  }
  return Math.min(Math.max(value, low), high);
}

/** Puts every dot back inside the box, with room for its name at the sides and below. */
function keepInside(nodes: Node[], box: Box) {
  const top = -box.height / 2 + EDGE + ABOVE;
  const bottom = box.height / 2 - EDGE - BELOW;
  for (const node of nodes) {
    const across = box.width / 2 - EDGE - node.radius;
    node.x = clamp(node.x ?? 0, -across, across);
    node.y = clamp(node.y ?? 0, top, bottom);
  }
}

/**
 * Lets the forces settle, one step at a time, keeping everyone inside the box after each step so
 * the graph spreads out to fill it instead of growing past it.
 */
function settle(nodes: Node[], links: Link[], heat: number, box: Box) {
  const simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links).id((node) => node.id).distance(150))
    .force('charge', forceManyBody().strength(-700))
    .force('collide', forceCollide<Node>((node) => node.radius).iterations(3))
    .force('x', forceX(0).strength(0.03))
    .force('y', forceY(0).strength(0.05))
    .alpha(heat)
    .stop();
  for (let step = 0; step < TICKS; step += 1) {
    simulation.tick();
    keepInside(nodes, box);
  }
}

function placesOf(nodes: Node[]): Map<string, Point> {
  const points = new Map<string, Point>();
  for (const node of nodes) {
    points.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
  return points;
}

/**
 * Where each dot goes, inside the box. Dots that were placed before start where they were, so a
 * change moves the graph a little instead of shuffling it.
 */
export function layOut(dots: Dot[], pairs: [string, string][], box: Box, before: Map<string, Point>): Map<string, Point> {
  if (dots.length === 0) {
    return new Map();
  }
  const nodes = dots.map((dot) => nodeFor(dot, before));
  placeNewcomers(nodes, pairs, before);
  const links: Link[] = pairs.map(([source, target]) => ({ source, target }));
  settle(nodes, links, startingHeat(nodes, before), box);
  return placesOf(nodes);
}
