import type { CharacterSeed, ForgeDraftCastMember } from '../types/forge';
import type { CastMember, Blueprint } from '../types';

/**
 * Creates a neutral seed for a cast member that reproduces today's engine defaults:
 * - where: starting_location or presenceDisposition or startingNodeId or 'ORIGIN'
 * - doing: ACTIVE at first routine step if routines exist; SUSPENDED if not
 * - condition: empty (no restraint bindings)
 * - charge: { band: 'calm' } (zero fear, default threatType)
 * - knows: []
 * - bonds: []
 * - NPC wants: { kind: 'state', text: goals || '' }
 * - User character: circumstance: description || '', inclination: goals || ''
 */
export function createNeutralSeed(
  member: Partial<CastMember | ForgeDraftCastMember> | Record<string, unknown>,
  blueprint?: Partial<Blueprint> | Record<string, unknown>
): CharacterSeed {
  const isUserChar = Boolean(member.isUserCharacter);

  // 1. Resolve starting node
  let whereNode = '';
  if (typeof member.starting_location === 'string' && member.starting_location.trim().length > 0) {
    whereNode = member.starting_location.trim();
  } else if (
    member.presenceDisposition &&
    typeof member.presenceDisposition === 'object' &&
    (member.presenceDisposition as { kind?: string; nodeId?: string }).kind === 'AT_NODE' &&
    (member.presenceDisposition as { nodeId?: string }).nodeId
  ) {
    whereNode = (member.presenceDisposition as { nodeId: string }).nodeId.trim();
  } else {
    const topo = blueprint?.topology as
      | {
          startingNodeId?: string;
          nodeDefinitions?: Array<{ id: string }>;
          nodes?: string[];
        }
      | undefined;
    if (
      topo?.startingNodeId &&
      typeof topo.startingNodeId === 'string' &&
      topo.startingNodeId.trim().length > 0
    ) {
      whereNode = topo.startingNodeId.trim();
    } else if (
      Array.isArray(topo?.nodeDefinitions) &&
      topo.nodeDefinitions.length > 0 &&
      topo.nodeDefinitions[0]?.id
    ) {
      whereNode = topo.nodeDefinitions[0].id;
    } else if (Array.isArray(topo?.nodes) && topo.nodes.length > 0 && topo.nodes[0]) {
      whereNode = topo.nodes[0];
    } else {
      whereNode = 'ORIGIN';
    }
  }
  if (!whereNode || whereNode.trim().length === 0) {
    whereNode = 'ORIGIN';
  }

  type RoutineLike = {
    characterId?: string;
    steps?: Array<{ stepNumber?: number; actionSummary?: string; nodeId?: string }>;
  };
  let memberRoutines: RoutineLike[] = [];

  if (blueprint) {
    const bpRecord = blueprint as Record<string, unknown>;
    const r = bpRecord.routines;
    const rl = bpRecord.routineLedger;
    if (Array.isArray(r)) {
      memberRoutines = (r as RoutineLike[]).filter((item) => item?.characterId === member.id);
    } else if (r && typeof r === 'object') {
      memberRoutines = Object.values(r as Record<string, RoutineLike>).filter(
        (item) => item?.characterId === member.id
      );
    } else if (rl && typeof rl === 'object') {
      memberRoutines = Object.values(rl as Record<string, RoutineLike>).filter(
        (item) => item?.characterId === member.id
      );
    }
  }

  if (memberRoutines.length === 0 && Array.isArray((member as Record<string, unknown>).routines)) {
    memberRoutines = (member as Record<string, unknown>).routines as RoutineLike[];
  }

  let doing: CharacterSeed['doing'];
  if (memberRoutines.length > 0 && memberRoutines[0].steps && memberRoutines[0].steps.length > 0) {
    const firstStep = memberRoutines[0].steps[0];
    doing = {
      mode: 'ACTIVE',
      routineStep: String(firstStep.stepNumber ?? 1),
      verb: 'INVESTIGATE',
    };
  } else {
    doing = {
      mode: 'SUSPENDED',
    };
  }

  // 3. Condition: empty restraint
  const condition: CharacterSeed['condition'] = {};

  // 4. Charge: calm
  const charge: CharacterSeed['charge'] = {
    band: 'calm',
  };

  // 5. Knows & bonds: empty
  const knows: CharacterSeed['knows'] = [];
  const bonds: CharacterSeed['bonds'] = [];

  // 6. Branch on User character vs NPC
  if (isUserChar) {
    return {
      where: whereNode,
      doing,
      condition,
      charge,
      knows,
      circumstance: typeof member.description === 'string' ? member.description : '',
      inclination: typeof member.goals === 'string' ? member.goals : '',
      bonds,
    };
  } else {
    return {
      where: whereNode,
      doing,
      condition,
      charge,
      knows,
      wants: {
        kind: 'state',
        text: typeof member.goals === 'string' ? member.goals : '',
      },
      bonds,
    };
  }
}
