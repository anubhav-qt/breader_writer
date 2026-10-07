import type { AgentTool } from '@writer/pi-agent';
import { Type } from '@writer/pi-ai';
import { undashed } from '../ai/dashes.ts';
import { endScene, joinCast, setScene, type Offer } from '../breading_ground.ts';
import { castByName, castOf } from '../story/cast.ts';
import { StoryError } from '../story/changes.ts';
import type { Cast } from '../story/mentions.ts';
import type { Cue, Scene } from '../story/scenes.ts';
import { cueActor, sendBack, type Moment } from './actor.ts';
import type { Procreator } from './run.ts';
import { bareName, guarded, memoryTools, personNamed, writerOf, type Result, type ToolContext } from './tools.ts';

/*
 * Procreator's play tools: set_scene, join_cast, cue, send_back and end_scene while it plays, and
 * offer_openings and offer_moves when the owner asks for openings or hints. They're declared in
 * every call of a session beside the memory tools, the same each time, or the cache misses; each
 * turns down a call made outside its time, saying what to do instead.
 */

/** What the play tools did in a run, for play to act on once it's done. */
export interface Outcome {
  /** The scene ended, and this one waits for the owner to go on to it. */
  ended: Scene | null;
  /** The turn stopped here for the owner to say who plays someone about to act. */
  cued: Cue | null;
  /** The openings offered for the first scene. */
  openings: Offer[] | null;
  /** The moves offered as hints. */
  moves: string[] | null;
}

export function noOutcome(): Outcome {
  return { ended: null, cued: null, openings: null, moves: null };
}

export interface PlayContext extends ToolContext {
  /** Procreator itself, for the actors it cues. */
  ai: Procreator;
  /**
   * The owner plays others too (the switch "Main character and author only", off): a cue stops
   * the turn for them to say who plays the one about to act.
   */
  playOthers: boolean;
  outcome: Outcome;
  /** Told where and when the scene is, and who is in it, whenever set_scene changes it. */
  onScene: (scene: Scene) => void;
}

/** Whether the run has stopped: the scene ended, or the owner is saying who plays someone. */
export function stopped(outcome: Outcome): boolean {
  return outcome.ended !== null || outcome.cued !== null;
}

/** Playing the story's tools work only while it's being played, and not once the turn has stopped. */
function mustPlay(context: PlayContext, tool: string) {
  if (context.mode !== 'play') {
    throw new StoryError(`${tool} is for playing the story. Do what was asked of you now.`);
  }
  if (context.outcome.ended) {
    throw new StoryError('This scene has ended. Write nothing more.');
  }
  if (context.outcome.cued) {
    throw new StoryError('The owner is saying who plays the one you cued. Write nothing more now.');
  }
}

/** Everyone named, by id. */
function peopleNamed(cast: Cast, names: string[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const id = personNamed(cast, name);
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function done(text: string): Result {
  return { content: [{ type: 'text', text }], details: {}, terminate: true };
}

const Where = Type.String({ description: 'Where, as a heading would say it ("Harrowgate hall").' });
const When = Type.String({ description: 'When, in the story’s own time ("the morning after the fire").' });
const Who = Type.Array(Type.String(), {
  description: 'People in the cast, by name. The one the owner plays is always in a scene, named or not.',
});

const SetScene = Type.Object({
  where: Type.Optional(Where),
  when: Type.Optional(When),
  who: Type.Optional(Type.Array(Type.String(), { description: 'People in the cast who are in the scene, by name. Anyone named is added; no one is taken off.' })),
});

function setSceneTool(context: PlayContext): AgentTool<typeof SetScene> {
  return {
    name: 'set_scene',
    label: 'Set the scene',
    description:
      'Says where and when the scene being played is, and who in the cast is in it. The owner sees where and when as the scene’s heading. Call it as a scene opens if your brief doesn’t say, and whenever someone in the cast comes into the scene.',
    parameters: SetScene,
    execute: (_id, params) =>
      guarded('set_scene', async () => {
        mustPlay(context, 'set_scene');
        const scene = await context.db.transaction(async (tx) => {
          const cast = await castByName(tx, context.scene.bookId);
          const joining = peopleNamed(cast, params.who ?? []);
          return setScene(tx, writerOf(context), context.scene, { place: params.where, time: params.when, joining });
        });
        context.onScene(scene);
        return `Scene ${scene.number} is set: ${scene.place || 'no place yet'}, ${scene.time || 'no time yet'}.`;
      }),
  };
}

const JoinCast = Type.Object({
  name: Type.String({ description: 'Their name, as the story calls them. No one else in the cast may have it.' }),
  who: Type.String({ description: 'Who they are, in a line or two.' }),
  personality: Type.String({ description: 'Their personality, as far as the story knows it.' }),
  past: Type.String({ description: 'Their past, as far as the story knows it. Leave it empty if nothing is known yet.' }),
});

function joinCastTool(context: PlayContext): AgentTool<typeof JoinCast> {
  return {
    name: 'join_cast',
    label: 'Join the cast',
    description:
      'Someone new who will matter beyond this scene joins the cast: they get a sheet like the owner’s people, the owner sees them join, and they’re in this scene. Call it before they act. Passing extras need none.',
    parameters: JoinCast,
    execute: (_id, params) =>
      guarded('join_cast', async () => {
        mustPlay(context, 'join_cast');
        const newcomer = { name: params.name, who: params.who, personality: params.personality, past: params.past };
        const person = await context.db.transaction((tx) => joinCast(tx, writerOf(context), context.scene, newcomer));
        return `${person.name} joins the cast, and is in this scene. Write their page as the story gives them depth.`;
      }),
  };
}

const Who1 = Type.String({ description: 'Someone in the cast, by name, but the one the owner plays.' });

const CueParams = Type.Object({
  who: Who1,
  sees: Type.String({
    description:
      'What they see, hear and know now: what has happened since they were last cued, as they took it in, in a few sentences. Only what they could know, and nothing of the plot.',
  }),
});

/** The one in the cast an actor plays, by name: not the owner's, and in the scene, which they come into if they weren't. */
async function actorNamed(context: PlayContext, name: string): Promise<{ id: string; name: string }> {
  const bookId = context.scene.bookId;
  return context.db.transaction(async (tx) => {
    const cast = await castByName(tx, bookId);
    const bare = bareName(name);
    const ids = cast.idsOf(bare);
    if (ids.length === 0) {
      throw new StoryError(`No one in the cast is called ${bare}. Only the cast have actors: play passing extras yourself.`);
    }
    if (ids.length > 1) {
      throw new StoryError(`More than one person in the cast is called ${bare}, so the cue can't tell which.`);
    }
    const people = await castOf(tx, bookId);
    const person = people.find((each) => each.id === ids[0]);
    if (!person) {
      throw new StoryError(`No one in the cast is called ${bare}.`);
    }
    if (person.role === 'protagonist') {
      throw new StoryError(`${person.name} is the owner's to play. Stop at a moment where ${person.name} can act.`);
    }
    await setScene(tx, writerOf(context), context.scene, { joining: [person.id] });
    return { id: person.id, name: person.name };
  });
}

/** The moment a tool cues someone at: the turn being played. */
function momentOf(context: PlayContext, person: { id: string; name: string }): Moment {
  if (context.turnId === null) {
    throw new Error('A cue needs the turn it’s made at.');
  }
  return { person, scene: context.scene, turnId: context.turnId };
}

function cueTool(context: PlayContext): AgentTool<typeof CueParams> {
  return {
    name: 'cue',
    label: 'Cue an actor',
    description:
      'Asks the actor who plays someone in the cast what they do, say and think now, and gives their answer. Call it whenever someone in the cast is about to act or speak, before you write their part, then write it from the answer. Sometimes the owner says who plays them first, and your turn stops here.',
    parameters: CueParams,
    execute: async (_id, params) => {
      const result = await guarded('cue', async () => {
        mustPlay(context, 'cue');
        const person = await actorNamed(context, params.who);
        const sees = undashed(params.sees.trim());
        if (context.playOthers) {
          context.outcome.cued = { who: person.id, sees };
          return `The owner is deciding whether to play ${person.name} this time or let their actor. Write nothing more now: the next message brings what ${person.name} does.`;
        }
        const answer = await cueActor(context.ai, momentOf(context, person), sees);
        return `${person.name}’s actor answers:\n\n${answer}`;
      });
      if (context.outcome.cued) {
        return { ...result, terminate: true };
      }
      return result;
    },
  };
}

const SendBackParams = Type.Object({
  who: Who1,
  note: Type.String({ description: 'A note on the character, never the plot ("she wouldn’t give in so soon").' }),
});

function sendBackTool(context: PlayContext): AgentTool<typeof SendBackParams> {
  return {
    name: 'send_back',
    label: 'Send an answer back',
    description:
      'Sends an actor’s answer from this turn back with a note on the character, and gives their new answer. Use it when an answer doesn’t fit who they are or what the moment can hold.',
    parameters: SendBackParams,
    execute: (_id, params) =>
      guarded('send_back', async () => {
        mustPlay(context, 'send_back');
        const person = await actorNamed(context, params.who);
        const answer = await sendBack(context.ai, momentOf(context, person), undashed(params.note.trim()));
        return `${person.name}’s actor answers again:\n\n${answer}`;
      }),
  };
}

const EndScene = Type.Object({
  where: Type.String({ description: 'Where the next scene opens, as a heading would say it.' }),
  when: Type.String({ description: 'When it opens, in the story’s own time.' }),
  who: Who,
});

function endSceneTool(context: PlayContext): AgentTool<typeof EndScene> {
  return {
    name: 'end_scene',
    label: 'End the scene',
    description:
      'Ends the scene being played, once its last moment is written, because the story moves to another place or time. Says where and when the next scene opens and who is in it; the owner goes on to it when they’re ready. It’s the last thing you do in a turn.',
    parameters: EndScene,
    execute: async (_id, params) => {
      const result = await guarded('end_scene', async () => {
        mustPlay(context, 'end_scene');
        const next = await context.db.transaction(async (tx) => {
          const cast = await castByName(tx, context.scene.bookId);
          const present = peopleNamed(cast, params.who);
          return endScene(tx, writerOf(context), context.scene, { place: params.where, time: params.when, present });
        });
        context.outcome.ended = next;
        return `Scene ${context.scene.number} has ended. The owner sees its end, and goes on to scene ${next.number} when they’re ready. Write nothing more.`;
      });
      return { ...result, terminate: true };
    },
  };
}

const Opening = Type.Object({
  opening: Type.String({ description: 'The opening as the owner reads it, in a line or two.' }),
  where: Where,
  when: When,
  who: Who,
});

const OfferOpenings = Type.Object({
  openings: Type.Array(Opening, { minItems: 3, maxItems: 3, description: 'Three openings, each different in kind.' }),
});

function offerOpeningsTool(context: PlayContext): AgentTool<typeof OfferOpenings> {
  return {
    name: 'offer_openings',
    label: 'Offer openings',
    description: 'Offers the owner three ways to open the story’s first scene, to pick from. Only when they ask for openings.',
    parameters: OfferOpenings,
    execute: async (_id, params) => {
      if (context.mode !== 'openings') {
        throw new StoryError('offer_openings is only for when the owner asks how the story could open.');
      }
      const cast = await castByName(context.db, context.scene.bookId);
      const offers: Offer[] = [];
      for (const each of params.openings) {
        const present = peopleNamed(cast, each.who);
        offers.push({ text: each.opening.trim(), place: each.where.trim(), time: each.when.trim(), present });
      }
      context.outcome.openings = offers;
      return done('The owner sees your openings now. Wait for them.');
    },
  };
}

const OfferMoves = Type.Object({
  moves: Type.Array(Type.String(), { minItems: 3, maxItems: 3, description: 'Three moves, each different in kind.' }),
});

function offerMovesTool(context: PlayContext): AgentTool<typeof OfferMoves> {
  return {
    name: 'offer_moves',
    label: 'Offer moves',
    description: 'Offers the owner three moves they could make next, to pick from or change. Only when they ask for hints.',
    parameters: OfferMoves,
    execute: async (_id, params) => {
      if (context.mode !== 'hints') {
        throw new StoryError('offer_moves is only for when the owner asks for hints.');
      }
      context.outcome.moves = params.moves.map((move) => undashed(move.trim()));
      return done('The owner sees your moves now. Wait for them.');
    },
  };
}

/** Every tool of a run in a scene's session: the memory tools, then the play tools, the same every call. */
export function toolsFor(context: PlayContext): AgentTool[] {
  const play = [
    setSceneTool(context),
    joinCastTool(context),
    cueTool(context),
    sendBackTool(context),
    endSceneTool(context),
    offerOpeningsTool(context),
    offerMovesTool(context),
  ];
  return [...memoryTools(context), ...(play as AgentTool[])];
}
