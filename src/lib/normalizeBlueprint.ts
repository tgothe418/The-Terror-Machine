import { z } from 'zod';
import { BlueprintSchema, Blueprint } from '../types';
import { createNeutralSeed } from './neutralSeed';
import { mergeVillainPersonasIntoCast } from './castVillain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function normalizeLegacyBlueprintShape(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const rawRecord = raw;

  // Extract protagonist ID: prefer userCharacterId, then cast.isUserCharacter, then perspectives
  let protagonistId: unknown = undefined;
  if (hasOwn(rawRecord, 'userCharacterId') && rawRecord.userCharacterId !== undefined) {
    protagonistId = rawRecord.userCharacterId;
  } else if (Array.isArray(rawRecord.cast)) {
    const userMember = rawRecord.cast.find((c) => isRecord(c) && c.isUserCharacter);
    if (isRecord(userMember) && typeof userMember.id === 'string') {
      protagonistId = userMember.id;
    }
  } else if (Array.isArray(rawRecord.perspectives)) {
    const found = rawRecord.perspectives.find((p) => isRecord(p) && p.role === 'PROTAGONIST');
    if (isRecord(found) && typeof found.subjectCharacterId === 'string') {
      protagonistId = found.subjectCharacterId;
    }
  }

  // Normalize cast isUserCharacter and synthesize neutral seed if missing
  let castNormalized: unknown = rawRecord.cast;
  if (Array.isArray(rawRecord.cast)) {
    castNormalized = rawRecord.cast.map((c) => {
      if (isRecord(c)) {
        const isUser =
          typeof protagonistId === 'string'
            ? c.id === protagonistId
            : Boolean(c.isUserCharacter);
        const withUserChar: Record<string, unknown> = {
          ...c,
          ...(typeof protagonistId === 'string' ? { isUserCharacter: isUser } : {}),
        };
        if (!hasOwn(withUserChar, 'seed') || !withUserChar['seed']) {
          return {
            ...withUserChar,
            seed: createNeutralSeed(withUserChar, rawRecord),
          };
        }
        return withUserChar;
      }
      return c;
    });
  }

  // Normalize topology and topology.connections
  let topologyNormalized: unknown = undefined;
  if (hasOwn(rawRecord, 'topology') && rawRecord.topology !== undefined) {
    if (!isRecord(rawRecord.topology)) {
      // Preserve explicitly supplied wrong-typed topology
      topologyNormalized = rawRecord.topology;
    } else {
      const topoRecord = rawRecord.topology;
      let connectionsNormalized: unknown = undefined;
      if (hasOwn(topoRecord, 'connections') && topoRecord.connections !== undefined) {
        if (!Array.isArray(topoRecord.connections)) {
          // Preserve explicitly supplied wrong-typed connections
          connectionsNormalized = topoRecord.connections;
        } else {
          connectionsNormalized = topoRecord.connections.map((conn) => {
            if (typeof conn === 'string') {
              const parts = conn.split('->').map((s: string) => s.trim());
              return {
                from: parts[0] || '',
                to: parts[1] || '',
                kind: 'PHYSICAL',
                userInitiated: true,
                legacyUpgraded: true,
              };
            }

            if (!isRecord(conn)) {
              return conn;
            }

            const safeConn = { ...conn };
            const validKinds = [
              'PHYSICAL',
              'FORCED_EVENT',
              'MEMORY_RECONSTRUCTION',
              'HISTORICAL_REFERENCE',
              'TERMINAL_EJECTION',
              'AUTHORED_PARADOX',
            ];

            // If kind is absent/undefined, default to PHYSICAL
            if (!hasOwn(safeConn, 'kind') || safeConn.kind === undefined) {
              safeConn.kind = 'PHYSICAL';
            } else if (typeof safeConn.kind === 'string') {
              let upperKind = safeConn.kind.toUpperCase();
              if (upperKind === 'SPATIAL') upperKind = 'PHYSICAL';
              if (upperKind === 'NARRATIVE') upperKind = 'FORCED_EVENT';
              if (!validKinds.includes(upperKind)) upperKind = 'PHYSICAL';
              safeConn.kind = upperKind;
            }
            // If kind is present with non-undefined, non-string value, keep it unmodified so EdgeKindSchema rejects it

            if (!hasOwn(safeConn, 'userInitiated') || safeConn.userInitiated === undefined) {
              if (typeof safeConn.kind === 'string') {
                safeConn.userInitiated = safeConn.kind === 'PHYSICAL';
              }
            }

            return safeConn;
          });
        }
      }

      const isRichTopology =
        hasOwn(topoRecord, 'nodeDefinitions') &&
        Array.isArray(topoRecord.nodeDefinitions) &&
        topoRecord.nodeDefinitions.length > 0;

      let startingNodeIdNormalized: unknown = topoRecord.startingNodeId;
      if (!isRichTopology) {
        // Legacy flat topology compatibility fallback
        if (!startingNodeIdNormalized && Array.isArray(topoRecord.nodes) && topoRecord.nodes.length > 0) {
          startingNodeIdNormalized = topoRecord.nodes[0];
        }
      }

      let nodesNormalized: unknown = topoRecord.nodes;
      if (isRichTopology && Array.isArray(topoRecord.nodeDefinitions)) {
        nodesNormalized = topoRecord.nodeDefinitions
          .map((d: unknown) => (isRecord(d) && typeof d.id === 'string' ? d.id : null))
          .filter((id: string | null): id is string => id !== null);
      } else if (
        (!Array.isArray(nodesNormalized) || nodesNormalized.length === 0) &&
        Array.isArray(topoRecord.nodeDefinitions) &&
        topoRecord.nodeDefinitions.length > 0
      ) {
        nodesNormalized = topoRecord.nodeDefinitions
          .map((d: unknown) => (isRecord(d) && typeof d.id === 'string' ? d.id : null))
          .filter((id: string | null): id is string => id !== null);
      }

      topologyNormalized = {
        ...topoRecord,
        ...(startingNodeIdNormalized !== undefined ? { startingNodeId: startingNodeIdNormalized } : {}),
        ...(nodesNormalized !== undefined ? { nodes: nodesNormalized } : {}),
        ...(connectionsNormalized !== undefined ? { connections: connectionsNormalized } : {}),
      };
    }
  }

  // Normalize identity and title fallback
  let identityNormalized: unknown = undefined;
  let topLevelTitleNormalized: unknown = undefined;

  const hasExplicitIdentity = hasOwn(rawRecord, 'identity') && rawRecord.identity !== undefined;
  const hasExplicitTopTitle = hasOwn(rawRecord, 'title') && rawRecord.title !== undefined;

  if (hasExplicitIdentity) {
    if (!isRecord(rawRecord.identity)) {
      // Preserve explicit non-record identity (e.g. 42, null, array, string)
      identityNormalized = rawRecord.identity;
    } else {
      const identRecord = rawRecord.identity;
      let identTitle: unknown = identRecord.title;
      if (!hasOwn(identRecord, 'title') || identTitle === undefined) {
        if (typeof rawRecord.title === 'string' && rawRecord.title) {
          identTitle = rawRecord.title;
        }
      }
      identityNormalized = {
        ...identRecord,
        ...(identTitle !== undefined ? { title: identTitle } : {}),
      };
    }
  } else {
    // Missing or undefined identity: if top-level title is string, populate identity.title
    if (typeof rawRecord.title === 'string' && rawRecord.title) {
      identityNormalized = {
        title: rawRecord.title,
      };
    }
  }

  if (hasExplicitTopTitle) {
    topLevelTitleNormalized = rawRecord.title;
  } else if (
    isRecord(rawRecord.identity) &&
    typeof rawRecord.identity.title === 'string' &&
    rawRecord.identity.title
  ) {
    topLevelTitleNormalized = rawRecord.identity.title;
  }

  // Normalize premise / globalPremise
  let topPremiseNormalized: unknown = undefined;
  let globalPremiseNormalized: unknown = undefined;

  const hasExplicitTopPremise = hasOwn(rawRecord, 'premise') && rawRecord.premise !== undefined;
  const hasExplicitGlobalPremise =
    hasOwn(rawRecord, 'globalPremise') && rawRecord.globalPremise !== undefined;

  if (hasExplicitTopPremise) {
    topPremiseNormalized = rawRecord.premise;
  } else if (typeof rawRecord.globalPremise === 'string' && rawRecord.globalPremise) {
    topPremiseNormalized = rawRecord.globalPremise;
  }

  if (hasExplicitGlobalPremise) {
    globalPremiseNormalized = rawRecord.globalPremise;
  } else if (typeof rawRecord.premise === 'string' && rawRecord.premise) {
    globalPremiseNormalized = rawRecord.premise;
  }

  let userOpeningAimNormalized: unknown = rawRecord.userOpeningAim;
  if (!userOpeningAimNormalized && isRecord(rawRecord.horrorGrammar) && rawRecord.horrorGrammar.userOpeningAim) {
    userOpeningAimNormalized = rawRecord.horrorGrammar.userOpeningAim;
  }

  // Normalize antagonistProfile - synthesize default if absent
  let antagonistProfileNormalized: unknown = undefined;
  const topologyNodes: string[] = [];
  if (isRecord(topologyNormalized) && Array.isArray(topologyNormalized.nodes)) {
    for (const n of topologyNormalized.nodes) {
      if (typeof n === 'string') topologyNodes.push(n);
    }
  } else if (isRecord(rawRecord.topology) && Array.isArray(rawRecord.topology.nodes)) {
    for (const n of rawRecord.topology.nodes) {
      if (typeof n === 'string') topologyNodes.push(n);
    }
  }

  const castList: Array<Record<string, unknown>> = [];
  if (Array.isArray(castNormalized)) {
    castList.push(...castNormalized.filter(isRecord));
  } else if (Array.isArray(rawRecord.cast)) {
    castList.push(...rawRecord.cast.filter(isRecord));
  }

  if (
    hasOwn(rawRecord, 'antagonistProfile') &&
    rawRecord.antagonistProfile !== undefined &&
    isRecord(rawRecord.antagonistProfile)
  ) {
    antagonistProfileNormalized = rawRecord.antagonistProfile;
  } else {
    antagonistProfileNormalized = synthesizeDefaultAntagonistProfile(
      rawRecord,
      topologyNodes,
      castList
    );
  }

  return {
    ...rawRecord,
    ...(topologyNormalized !== undefined ? { topology: topologyNormalized } : {}),
    ...(identityNormalized !== undefined ? { identity: identityNormalized } : {}),
    ...(topLevelTitleNormalized !== undefined ? { title: topLevelTitleNormalized } : {}),
    ...(topPremiseNormalized !== undefined ? { premise: topPremiseNormalized } : {}),
    ...(globalPremiseNormalized !== undefined ? { globalPremise: globalPremiseNormalized } : {}),
    ...(protagonistId !== undefined ? { userCharacterId: protagonistId } : {}),
    ...(castNormalized !== undefined ? { cast: castNormalized } : {}),
    ...(userOpeningAimNormalized !== undefined ? { userOpeningAim: userOpeningAimNormalized } : {}),
    ...(antagonistProfileNormalized !== undefined ? { antagonistProfile: antagonistProfileNormalized } : {}),
    ...(hasOwn(rawRecord, 'villainProtagonist') ? { villainProtagonist: Boolean(rawRecord.villainProtagonist) } : {}),
    // Strictly a legacy backfill for pre-compiled blueprints that lack deathContract
    ...(hasOwn(rawRecord, 'deathContract') && rawRecord.deathContract !== undefined
      ? { deathContract: rawRecord.deathContract }
      : {
          deathContract: {
            metaphysics: 'mundane',
            powerBudget: 'Standard environmental and mortal physical limitations.',
            seatSuccession: {},
          },
        }),
    // Strictly a legacy backfill for pre-compiled blueprints that lack fearContract
    ...(hasOwn(rawRecord, 'fearContract') && rawRecord.fearContract !== undefined
      ? { fearContract: rawRecord.fearContract }
      : {
          fearContract: {
            fearlessness: {},
            mortalityBelief: {},
            threatWeights: { life: 1.0, freedom: 1.0, identity: 1.0 },
            lambdaDecay: 0.35,
            residueRatio: 0.25,
            preyEnterThreshold: 0.70,
            preyExitThreshold: 0.40,
            somaticBands: { band1: 0.25, band2: 0.50, band3: 0.75, band4: 0.90 },
            releaseValves: [],
            villainGazeAuthorized: false,
            submitResponse: {},
          },
        }),
  };
}

function synthesizeDefaultAntagonistProfile(
  _rawRecord: Record<string, unknown>,
  topologyNodes: string[],
  castList: Array<Record<string, unknown>>
): Record<string, unknown> {
  const entityMember = castList.find(
    (c) =>
      c.isEntity === true ||
      String(c.role || '').toUpperCase().includes('ANTAGONIST') ||
      String(c.role || '').toUpperCase().includes('OPPOSITION')
  );

  const entityName =
    entityMember && typeof entityMember.name === 'string' && entityMember.name.trim()
      ? entityMember.name.trim()
      : 'The Facility Subsystem';

  const isEntityAvatar = entityMember && entityMember.isEntity === true;
  const validNodes = topologyNodes.length > 0 ? topologyNodes : ['NODE_ENTRY'];

  const apparatusControls = [
    {
      id: 'apparatus-hydraulic-bulkheads',
      name: 'Hydraulic Bulkheads & Lockdown Dogs',
      affectedNodeIds: [...validNodes],
      kind: 'HYDRAULICS',
      availableActions: ['SEAL_BULKHEAD', 'LOCK_PRESSURE_DOGS', 'FORCE_DECOMPRESSION'],
      status: 'ONLINE',
    },
    {
      id: 'apparatus-atmospheric-matrix',
      name: 'Atmospheric Scrubber & Vent Matrix',
      affectedNodeIds: [...validNodes],
      kind: 'ATMOSPHERE',
      availableActions: ['VENT_REFRIGERANT', 'OXYGEN_DEPRIVATION', 'EXHAUST_TOXIC_COAGULUM'],
      status: 'ONLINE',
    },
    {
      id: 'apparatus-lighting-relays',
      name: 'Auxiliary Electrical Relay & Lighting Grid',
      affectedNodeIds: [...validNodes],
      kind: 'ELECTRICAL',
      availableActions: ['KILL_LIGHTING', 'STROBE_ALARM', 'OVERLOAD_SOLENOID'],
      status: 'ONLINE',
    },
    {
      id: 'apparatus-intercom-grid',
      name: 'Facility Acoustic Intercom & Grate Resonator',
      affectedNodeIds: [...validNodes],
      kind: 'ACOUSTIC',
      availableActions: ['BROADCAST_FEEDBACK', 'RESONATE_GRATE', 'WHISPER_VOICE'],
      status: 'ONLINE',
    },
  ];

  const mortalMembers = castList.filter(
    (c) => !c.isEntity && !String(c.role || '').toUpperCase().includes('ANTAGONIST')
  );

  const preyCohort = mortalMembers.map((m, idx) => {
    const name =
      typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `Subject-${idx + 1}`;
    const id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : `prey-${idx + 1}`;
    const startLoc =
      typeof m.starting_location === 'string' && m.starting_location
        ? m.starting_location
        : validNodes[0];

    return {
      id,
      name,
      vulnerabilities: [
        'Acute physiological shock under sustained trauma',
        'Loss of coordination in darkness or sub-zero temperature',
        'Psychological panic when isolated from companions',
      ],
      psychologicalTriggers: [
        'Sounds of automated machinery or impending containment',
        'Failure of life-support and lighting systems',
      ],
      breakingPoint: 'Catatonic panic or physiological shock collapse',
      initialNodeId: startLoc,
    };
  });

  const telemetryFeeds = validNodes.map((nodeId) => ({
    nodeId,
    feedType: 'ACOUSTIC_PICKUP' as const,
    status: 'ONLINE' as const,
    label: `Sensor Grid - ${nodeId}`,
  }));

  const sadisticDirectives = [
    'Preserve physiological viability of subjects until terminal containment or extraction.',
    'Methodically exploit acoustic and environmental tells to induce psychological breakdown.',
    'Isolate subjects to prevent cooperative mechanical bypass of containment bulkheads.',
  ];

  return {
    kind: isEntityAvatar ? 'APPARATUS' : 'FORCE',
    name: entityName,
    apparatusControls,
    preyCohort,
    sadisticDirectives,
    telemetryFeeds,
  };
}

export const NormalizedBlueprintSchema = z.preprocess(
  normalizeLegacyBlueprintShape,
  BlueprintSchema
);

export function normalizeBlueprint(raw: unknown): Blueprint {
  const blueprint = NormalizedBlueprintSchema.parse(raw);
  if (Array.isArray(blueprint.villains) && blueprint.villains.length > 0 && Array.isArray(blueprint.cast)) {
    blueprint.cast = mergeVillainPersonasIntoCast(blueprint.cast, blueprint.villains);
  }
  return blueprint;
}
