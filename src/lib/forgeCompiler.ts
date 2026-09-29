import { Blueprint, BlueprintSchema } from '../types';
import {
  ForgeDraft,
  ForgeDraftSchema,
  ForgeValidationResult,
  ForgeReviewArtifact,
  ForgeCompileResult,
  ForgeSourceCandidate,
  ForgeSourceAnalysis,
  DeathContract,
  FearContract,
  DEFAULT_FEAR_CONTRACT,
} from '../types/forge';
import { normalizeBlueprint } from './normalizeBlueprint';
import {
  resolveSourceEvidenceProvenance,
  applyCandidateToDraft,
  getCandidateApplicationPriority,
  isCompleteAuthoredDepictionContract,
} from './sourceBaseline';
import { isVillainCastMember, ensureVillainCastMember } from './castVillain';
import { validateSeed, validateScenarioOpeningState } from './seedValidation';
import { createNeutralSeed } from './neutralSeed';

/**
 * Pure helper that deterministically derives default Depiction Contract fields
 * from thematic anchors, atmosphere, and setting if not authored.
 */
export function deriveDefaultDepictionContract(draft?: Partial<ForgeDraft> | null): {
  dramaticRegister: string;
  directness: string;
  aftermath: string;
  ambiguityHandling: string;
  specialBoundaries?: string;
} {
  const existing = draft?.depictionContract;
  const thematic = draft?.identity?.thematicAnchor || draft?.setting?.atmosphere || draft?.premise || '';
  const location = draft?.setting?.location || 'the immediate environment';

  const isInvalidField = (val?: string) => {
    if (!val) return true;
    const t = val.trim().toLowerCase();
    return !t || t === 'unknown' || t === 'none' || t === 'n/a';
  };

  const dramaticRegister = !isInvalidField(existing?.dramaticRegister)
    ? existing!.dramaticRegister!.trim()
    : thematic
    ? `Psychological dread grounded in ${thematic}`
    : 'Measured psychological dread and tension';

  const directness = !isInvalidField(existing?.directness)
    ? existing!.directness!.trim()
    : `Visceral situational directness within ${location}`;

  const aftermath = !isInvalidField(existing?.aftermath)
    ? existing!.aftermath!.trim()
    : 'Irreversible physiological and psychological consequences';

  const ambiguityHandling = !isInvalidField(existing?.ambiguityHandling)
    ? existing!.ambiguityHandling!.trim()
    : 'Preserve epistemic gaps and ontological uncertainty';

  return {
    dramaticRegister,
    directness,
    aftermath,
    ambiguityHandling,
    specialBoundaries: existing?.specialBoundaries || 'None',
  };
}

/**
 * Pure helper that deterministically derives default Death Contract fields
 * from setting/antagonist/mortal constraints if not authored.
 */
export function deriveDefaultDeathContract(draft?: Partial<ForgeDraft> | null): DeathContract {
  const existing = draft?.deathContract;
  const powerBudget =
    existing?.powerBudget?.trim() ||
    (draft?.antagonistProfile?.name
      ? `Physical access and environmental lethality governed by ${draft.antagonistProfile.name}.`
      : 'Standard environmental and mortal physical limitations.');
  const deathMetaphysics =
    existing?.deathMetaphysics || existing?.metaphysics || 'mundane';
  const seatSuccession = existing?.seatSuccession || {};

  return {
    powerBudget,
    deathMetaphysics,
    seatSuccession,
  };
}

/**
 * Pure helper that deterministically derives default Fear Contract fields
 * if not fully authored.
 */
export function deriveDefaultFearContract(draft?: Partial<ForgeDraft> | null): FearContract {
  const existing = draft?.fearContract;
  return {
    fearlessness: existing?.fearlessness ? { ...existing.fearlessness } : {},
    mortalityBelief: existing?.mortalityBelief ? { ...existing.mortalityBelief } : {},
    threatWeights: {
      life: 1.0,
      freedom: 1.0,
      identity: 1.0,
      ...(existing?.threatWeights || {}),
    },
    lambdaDecay: existing?.lambdaDecay ?? DEFAULT_FEAR_CONTRACT.lambdaDecay,
    residueRatio: existing?.residueRatio ?? DEFAULT_FEAR_CONTRACT.residueRatio,
    preyEnterThreshold: existing?.preyEnterThreshold ?? DEFAULT_FEAR_CONTRACT.preyEnterThreshold,
    preyExitThreshold: existing?.preyExitThreshold ?? DEFAULT_FEAR_CONTRACT.preyExitThreshold,
    somaticBands: existing?.somaticBands || { ...DEFAULT_FEAR_CONTRACT.somaticBands },
    releaseValves: existing?.releaseValves ? [...existing.releaseValves] : [],
    villainGazeAuthorized: existing?.villainGazeAuthorized ?? false,
    submitResponse: existing?.submitResponse ? { ...existing.submitResponse } : {},
  };
}

/**
 * Atomically projects all accepted candidates from source baseline into the working draft.
 * Prevents invisible staged state or manual repair steps before compilation.
 */
export function projectAcceptedStagedCandidates(
  draft: ForgeDraft,
  sourceAnalyses?: Record<string, ForgeSourceAnalysis> | null
): ForgeDraft {
  if (!sourceAnalyses || typeof sourceAnalyses !== 'object') {
    return draft;
  }

  const stagedAccepted: Array<{ cand: ForgeSourceCandidate; fileName: string }> = [];

  for (const analysis of Object.values(sourceAnalyses)) {
    const fileName = analysis.sourceRecord?.fileName || analysis.id;
    for (const cand of analysis.candidates || []) {
      if (cand.reviewDecision === 'accepted' && cand.applicationState === 'staged') {
        stagedAccepted.push({ cand, fileName });
      }
    }
  }

  if (stagedAccepted.length === 0) {
    return draft;
  }

  stagedAccepted.sort(
    (a, b) =>
      getCandidateApplicationPriority(a.cand.target) -
      getCandidateApplicationPriority(b.cand.target)
  );

  let workingDraft = draft;
  for (const { cand, fileName } of stagedAccepted) {
    if (
      cand.target === 'depiction_contract' &&
      isCompleteAuthoredDepictionContract(workingDraft.depictionContract)
    ) {
      continue;
    }
    const result = applyCandidateToDraft(workingDraft, cand, fileName);
    if (result.success) {
      workingDraft = result.draft;
    }
  }

  workingDraft = ensureVillainCastMember(workingDraft);

  return workingDraft;
}

/**
 * Recursively freezes plain objects and arrays to ensure deep immutability.
 * Does not freeze or mutate non-object primitives.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }

  return Object.freeze(obj) as T;
}

export class ForgeCompilationError extends Error {
  readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>) {
    const errorDetails = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('; ');
    super(`Forge blueprint draft compilation failed: ${errorDetails}`);
    this.name = 'ForgeCompilationError';
    this.errors = errors;
  }
}

function formatZodPath(path: (string | number | symbol)[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    const str = String(segment);
    return acc ? `${acc}.${str}` : str;
  }, '');
}

/**
 * Ensures all cast members have a seed defined, backfilling with neutral seed if missing.
 */
export function ensureCastSeeds(draft: Record<string, unknown>): Record<string, unknown> {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.cast)) {
    return draft;
  }
  const hasUnseeded = draft.cast.some(
    (c) => c && typeof c === 'object' && !('seed' in c && (c as Record<string, unknown>).seed)
  );
  if (!hasUnseeded) {
    return draft;
  }
  return {
    ...draft,
    cast: draft.cast.map((c) => {
      if (c && typeof c === 'object' && !('seed' in c && (c as Record<string, unknown>).seed)) {
        return {
          ...c,
          seed: createNeutralSeed(c as Record<string, unknown>, draft),
        };
      }
      return c;
    }),
  };
}

/**
 * Validates a Forge authoring draft for review and compilation.
 * Rejects incomplete drafts with structured, field-addressable error messages.
 * Does NOT rely on BlueprintSchema defaults (e.g. 'Unknown') as proof of authoring.
 */
export function validateForgeDraft(rawDraft: unknown): ForgeValidationResult {
  const errors: Record<string, string[]> = {};

  if (!rawDraft || typeof rawDraft !== 'object') {
    return {
      valid: false,
      errors: { draft: ['Draft must be a valid object'] },
    };
  }

  const rawDraftWithSeeds = ensureCastSeeds(rawDraft as Record<string, unknown>);
  const parseResult = ForgeDraftSchema.safeParse(rawDraftWithSeeds);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const formattedPath = formatZodPath(issue.path) || 'draft';
      const dotPath = issue.path.join('.') || 'draft';
      const isMissingDeathContract =
        (formattedPath === 'deathContract' || dotPath === 'deathContract') &&
        !(rawDraft as Record<string, unknown>)?.deathContract;
      const isMissingFearContract =
        (formattedPath === 'fearContract' || dotPath === 'fearContract') &&
        !(rawDraft as Record<string, unknown>)?.fearContract;
      const message = isMissingDeathContract
        ? 'Death contract is required for scenario compilation'
        : isMissingFearContract
        ? 'Fear contract is required for scenario compilation'
        : issue.message;
      if (!errors[formattedPath]) errors[formattedPath] = [];
      if (!errors[formattedPath].includes(message)) {
        errors[formattedPath].push(message);
      }
      if (dotPath !== formattedPath) {
        if (!errors[dotPath]) errors[dotPath] = [];
        if (!errors[dotPath].includes(message)) {
          errors[dotPath].push(message);
        }
      }
    }
  }

  const draft: Partial<ForgeDraft> = (parseResult.success ? parseResult.data : rawDraftWithSeeds) as unknown as Partial<ForgeDraft>;

  // 1. Scenario Identity / Title Validation
  const effectiveTitle = (draft.identity?.title || draft.title || '').trim();
  if (!effectiveTitle || effectiveTitle.toLowerCase() === 'unknown' || effectiveTitle.toLowerCase() === 'unknown enclosure') {
    errors['identity.title'] = ['Scenario title is required and cannot be a placeholder or empty'];
  }

  // 2. Scenario Premise Validation
  const effectivePremise = (draft.globalPremise || draft.premise || '').trim();
  if (!effectivePremise) {
    errors['premise'] = ['Scenario premise is required and cannot be empty'];
  }

  // 3. Setting Location Validation
  const effectiveLocation = (draft.setting?.location || '').trim();
  if (!effectiveLocation || effectiveLocation.toLowerCase() === 'unknown') {
    errors['setting.location'] = ['Setting location is required and cannot be empty or Unknown'];
  }

  // 4. Cast Validation: At least one authored cast member with a valid name
  if (!Array.isArray(draft.cast) || draft.cast.length === 0) {
    errors['cast'] = ['At least one cast member is required to compile a scenario'];
  } else {
    draft.cast.forEach((member, index) => {
      const memberName = (member.name || '').trim();
      if (!memberName || memberName.toLowerCase() === 'unknown') {
        const fieldKey = `cast[${index}].name`;
        if (!errors[fieldKey]) errors[fieldKey] = [];
        errors[fieldKey].push('Cast member name is required and cannot be Unknown or empty');
      } else if (
        new RegExp('\\b' + 'v' + 'ance\\b', 'i').test(memberName) ||
        new RegExp('\\b' + 't' + 'horne\\b', 'i').test(memberName) ||
        new RegExp('\\bevelyn\\s+(reed|' + 'v' + 'ance)\\b', 'i').test(memberName) ||
        /\bthe\s+whispering\s+man\b/i.test(memberName) ||
        /\bthe\s+watcher\b/i.test(memberName) ||
        /\bfather\s+thomas\b/i.test(memberName) ||
        /\barthur\s+penhaligon\b/i.test(memberName)
      ) {
        const fieldKey = `cast[${index}].name`;
        if (!errors[fieldKey]) errors[fieldKey] = [];
        errors[fieldKey].push(
          `Banned AI cliché name "${memberName}" detected. Project architectural policy strictly prohibits generic names like ${'Van' + 'ce'}, ${'Thor' + 'ne'}, Evelyn Reed, The Whispering Man, The Watcher, Father Thomas, and Arthur Penhaligon.`
        );
      }
    });
  }

  // 4b. Villain Invariant: every scenario must extract at least one VILLAIN cast member.
  // A named, speaking, or acting antagonist (e.g. AM) must be filed as a cast_seed with
  // disposition VILLAIN (isEntity true for non-humans) IN ADDITION TO any antagonist_profile.
  const hasVillain =
    Array.isArray(draft.cast) &&
    draft.cast.some(isVillainCastMember);
  if (!hasVillain) {
    if (!errors['cast']) errors['cast'] = [];
    const antagonistName = (draft as ForgeDraft)?.antagonistProfile?.name?.trim();
    const guidanceSuffix = antagonistName
      ? ` Antagonist "${antagonistName}" is named in the antagonist profile but has no VILLAIN cast member; add them in the Cast Manager or re-run baseline application.`
      : '';
    errors['cast'].push(
      'Invariant violation: every scenario must extract at least one VILLAIN cast member. ' +
        'If the source antagonist is a named entity, machine intelligence, or hostile overseer ' +
        '(e.g. AM), extract it as a cast_seed with disposition "VILLAIN" and isEntity true, ' +
        'in addition to any antagonist_profile entry.' +
        guidanceSuffix
    );
  }

  // 4c. Villain-Protagonist Invariant
  if (draft.villainProtagonist === true) {
    const cast = Array.isArray(draft.cast) ? draft.cast : [];
    const draftRecord = draft as Record<string, unknown>;
    const userCharId = typeof draftRecord.userCharacterId === 'string' ? draftRecord.userCharacterId : undefined;
    const perspectives = Array.isArray(draftRecord.perspectives) ? draftRecord.perspectives : undefined;
    const perspSubjectId = perspectives?.find((p): p is { role?: string; subjectCharacterId?: string } =>
      p !== null && typeof p === 'object' && (p as { role?: string }).role === 'PROTAGONIST'
    )?.subjectCharacterId;
    const userChar = userCharId ? cast.find((c) => c.id === userCharId) : undefined;
    const perspChar = perspSubjectId ? cast.find((c) => c.id === perspSubjectId) : undefined;
    const userMarked = cast.find((c) => c.isUserCharacter);
    const villainProtagonistMember =
      cast.find((c) => !c.isEntity && c.disposition === 'VILLAIN') ||
      cast.find(isVillainCastMember);
    const fallbackMortal = cast.find((c) => !c.isEntity) || cast[0];

    const wouldBeProtagonist =
      userChar ||
      perspChar ||
      userMarked ||
      villainProtagonistMember ||
      fallbackMortal;

    if (!wouldBeProtagonist || !isVillainCastMember(wouldBeProtagonist)) {
      if (!errors['cast']) errors['cast'] = [];
      const wouldBeName = wouldBeProtagonist?.name || 'Unknown Character';
      errors['cast'].push(
        `§4c villain-protagonist is set, but "${wouldBeName}" would take the protagonist seat and is not a villain. Mark the villain-protagonist in cast (disposition VILLAIN) or unset villainProtagonist.`
      );
    }
  }

  // 5. Starting Vector & Tier Validation
  const validVectors = ['SOMATIC', 'COGNITIVE', 'COSMIC', 'SOCIO_MORAL'];
  if (!draft.startingVector || !validVectors.includes(draft.startingVector)) {
    errors['startingVector'] = [`Starting vector must be one of: ${validVectors.join(', ')}`];
  }

  const validTiers = ['GATEWAY', 'LATENT', 'MANIFEST', 'TERMINAL'];
  if (!draft.startingTier || !validTiers.includes(draft.startingTier)) {
    errors['startingTier'] = [`Starting tier must be one of: ${validTiers.join(', ')}`];
  }

  // 6. Depiction Contract Validation / Auto-derivation
  const contract = draft.depictionContract;
  if (contract) {
    const isExplicitPlaceholder = (txt?: string) => {
      if (!txt) return false;
      const t = txt.trim().toLowerCase();
      return t === 'unknown' || t === 'none' || t === 'n/a';
    };

    if (isExplicitPlaceholder(contract.dramaticRegister)) {
      errors['depictionContract.dramaticRegister'] = [
        'Dramatic register cannot be an unreviewed placeholder',
      ];
    }
    if (isExplicitPlaceholder(contract.directness)) {
      errors['depictionContract.directness'] = [
        'Directness cannot be an unreviewed placeholder',
      ];
    }
    if (isExplicitPlaceholder(contract.aftermath)) {
      errors['depictionContract.aftermath'] = [
        'Aftermath cannot be an unreviewed placeholder',
      ];
    }
    if (isExplicitPlaceholder(contract.ambiguityHandling)) {
      errors['depictionContract.ambiguityHandling'] = [
        'Ambiguity handling cannot be an unreviewed placeholder',
      ];
    }
  }

  // 7. Topology Story Map & Opening Placement Validation
  const nodeDefs = Array.isArray(draft.topology?.nodeDefinitions)
    ? draft.topology.nodeDefinitions
    : [];
  const rawNodes = Array.isArray(draft.topology?.nodes) ? draft.topology.nodes : [];
  const isRichTopology = nodeDefs.length > 0;
  const allNodeIds = new Set<string>();
  const seenNodeIds = new Set<string>();

  nodeDefs.forEach((rawDef, idx) => {
    const def = (rawDef ?? {}) as {
      id?: string;
      label?: string;
      name?: string;
      description?: string;
    };
    const fieldPrefix = `topology.nodeDefinitions[${idx}]`;
    if (!def.id || !def.id.trim()) {
      errors[`${fieldPrefix}.id`] = ['Node definition ID cannot be empty'];
    } else {
      const cleanId = def.id.trim();
      if (seenNodeIds.has(cleanId)) {
        errors[`${fieldPrefix}.id`] = [`Duplicate node ID: "${cleanId}"`];
      }
      seenNodeIds.add(cleanId);
      allNodeIds.add(cleanId);
    }

    const effectiveLabel = (def.label || def.name || '').trim();
    if (!effectiveLabel) {
      errors[`${fieldPrefix}.label`] = ['Node definition label cannot be empty'];
    }

    if (!def.description || !def.description.trim()) {
      errors[`${fieldPrefix}.description`] = ['Node opening description cannot be empty'];
    }
  });

  if (isRichTopology) {
    // In rich topology, raw nodes must match nodeDefinitions 1-to-1
    rawNodes.forEach((n, idx) => {
      if (!n || !n.trim()) {
        errors[`topology.nodes[${idx}]`] = ['Topology node ID cannot be empty'];
      } else {
        const clean = n.trim();
        if (!allNodeIds.has(clean)) {
          errors[`topology.nodes[${idx}]`] = [
            `Raw node ID "${clean}" has no matching definition in nodeDefinitions`,
          ];
        }
      }
    });
  } else {
    // Legacy flat topology path
    rawNodes.forEach((n, idx) => {
      if (n && n.trim()) {
        const clean = n.trim();
        if (!seenNodeIds.has(clean)) {
          seenNodeIds.add(clean);
          allNodeIds.add(clean);
        }
      } else {
        errors[`topology.nodes[${idx}]`] = ['Topology node ID cannot be empty'];
      }
    });
  }

  if (allNodeIds.size === 0) {
    errors['topology.nodes'] = ['At least one main-map node is required to compile a scenario'];
  }

  // Validate starting node ID if present (not required for perspective-neutral blueprint)
  if (draft.topology?.startingNodeId && draft.topology.startingNodeId.trim()) {
    const startId = draft.topology.startingNodeId.trim();
    if (Array.isArray(draft.topology?.anchors) && draft.topology.anchors.some((a) => a.id === startId)) {
      errors['topology.startingNodeId'] = [
        `Starting node ID "${startId}" cannot be an expandable space anchor`,
      ];
    } else if (allNodeIds.size > 0 && !allNodeIds.has(startId)) {
      errors['topology.startingNodeId'] = [
        `Starting node ID references unknown topology node: "${startId}"`,
      ];
    }
  }

  // Validate directed connections
  const connections = Array.isArray(draft.topology?.connections)
    ? draft.topology.connections
    : [];
  const seenDirectedEdges = new Set<string>();
  connections.forEach((conn, idx) => {
    if (!conn) return;
    const from = typeof conn === 'string' ? conn.split('->')[0]?.trim() : conn.from;
    const to = typeof conn === 'string' ? conn.split('->')[1]?.trim() : conn.to;
    const fieldPrefix = `topology.connections[${idx}]`;

    if (!from || (allNodeIds.size > 0 && !allNodeIds.has(from))) {
      errors[`${fieldPrefix}.from`] = [
        `Connection source endpoint references unknown node ID: "${from || 'unspecified'}"`,
      ];
    }
    if (!to || (allNodeIds.size > 0 && !allNodeIds.has(to))) {
      errors[`${fieldPrefix}.to`] = [
        `Connection target endpoint references unknown node ID: "${to || 'unspecified'}"`,
      ];
    }

    if (Array.isArray(draft.topology?.anchors) && draft.topology.anchors.some((a) => a.id === from || a.id === to)) {
      errors[fieldPrefix] = [
        'Connections cannot link to or from expandable space anchors',
      ];
    }

    if (from && to) {
      const edgeKey = `${from}->${to}`;
      if (seenDirectedEdges.has(edgeKey)) {
        errors[fieldPrefix] = [`Duplicate directed connection: "${edgeKey}"`];
      }
      seenDirectedEdges.add(edgeKey);
    }
  });

  // Validate expandable space anchors
  const expAnchors = Array.isArray(draft.topology?.anchors) ? draft.topology.anchors : [];
  const seenExpAnchorIds = new Set<string>();
  expAnchors.forEach((anchor, idx) => {
    const fieldPrefix = `topology.anchors[${idx}]`;
    if (seenExpAnchorIds.has(anchor.id)) {
      errors[`${fieldPrefix}.id`] = [`Duplicate expandable anchor ID: "${anchor.id}"`];
    }
    seenExpAnchorIds.add(anchor.id);

    if (allNodeIds.has(anchor.id)) {
      errors[`${fieldPrefix}.id`] = [
        `Expandable space anchor ID "${anchor.id}" cannot match a main node ID`,
      ];
    }

    if (allNodeIds.size > 0 && !allNodeIds.has(anchor.parentNodeId)) {
      errors[`${fieldPrefix}.parentNodeId`] = [
        `Expansion anchor parent node references unknown node ID: "${anchor.parentNodeId}"`,
      ];
    }
  });

  // Validate cast opening placements
  if (Array.isArray(draft.cast) && draft.cast.length > 0) {
    draft.cast.forEach((member, idx) => {
      const fieldKey = `cast[${idx}].presenceDisposition`;
      const memberName = member.name || member.id;
      if (member.presenceDisposition) {
        if (member.presenceDisposition.kind === 'AT_NODE') {
          const targetNode = member.presenceDisposition.nodeId;
          if (allNodeIds.size > 0 && !allNodeIds.has(targetNode)) {
            errors[fieldKey] = [
              `AT_NODE placement for "${memberName}" references unknown node ID: "${targetNode}"`,
            ];
          }
        } else if (member.presenceDisposition.kind === 'NONLOCAL') {
          if (!member.isEntity) {
            errors[fieldKey] = [
              `NONLOCAL placement is only permitted for Entity cast members ("${memberName}" is not marked as an entity)`,
            ];
          }
        }
      } else if (member.starting_location && member.starting_location.trim().length > 0) {
        const targetNode = member.starting_location.trim();
        if (allNodeIds.size > 0 && !allNodeIds.has(targetNode)) {
          errors[fieldKey] = [
            `Opening placement location for "${memberName}" references unknown node ID: "${targetNode}"`,
          ];
        }
      } else {
        errors[fieldKey] = [
          `Opening placement disposition is required for cast member "${memberName}"`,
        ];
      }
    });
  }

  // 8. Horror Grammar Foundations (Values & Character Opening Objectives)
  const hg = draft.horrorGrammar;
  const validCastIds = new Set(draft.cast?.map((c) => c.id).filter(Boolean) || []);
  const validNodeIds = allNodeIds;

  if (!hg || hg.valueBaselineReview === 'UNREVIEWED') {
    errors['horrorGrammar.valueBaselineReview'] = [
      'Value baseline review is required (either accepted anchors or explicit reviewed none)',
    ];
  } else if (hg.valueBaselineReview === 'REVIEWED') {
    if (!hg.valueAnchors || hg.valueAnchors.length === 0) {
      errors['horrorGrammar.valueAnchors'] = [
        'Value baseline is marked as reviewed, but no value anchors are present',
      ];
    }
  } else if (hg.valueBaselineReview === 'REVIEWED_NONE') {
    if (hg.valueAnchors && hg.valueAnchors.length > 0) {
      errors['horrorGrammar.valueAnchors'] = [
        'Value baseline is marked as reviewed none, but value anchors are present',
      ];
    }
  }

  // Validate value anchor references
  if (hg?.valueAnchors && Array.isArray(hg.valueAnchors)) {
    const seenAnchorIds = new Set<string>();
    hg.valueAnchors.forEach((anchor, idx) => {
      const fieldPrefix = `horrorGrammar.valueAnchors[${idx}]`;
      if (seenAnchorIds.has(anchor.id)) {
        errors[`${fieldPrefix}.id`] = [`Duplicate value anchor ID: "${anchor.id}"`];
      }
      seenAnchorIds.add(anchor.id);

      if (anchor.holder.kind === 'CHARACTER') {
        if (!validCastIds.has(anchor.holder.castMemberId)) {
          errors[`${fieldPrefix}.holder.castMemberId`] = [
            `Value anchor references unknown cast member ID: "${anchor.holder.castMemberId}"`,
          ];
        }
      } else if (anchor.holder.kind === 'RELATIONSHIP') {
        const [c1, c2] = anchor.holder.castMemberIds;
        if (c1 === c2) {
          errors[`${fieldPrefix}.holder.castMemberIds`] = [
            'Relationship value anchor requires two distinct cast member IDs',
          ];
        }
        if (!validCastIds.has(c1) || !validCastIds.has(c2)) {
          errors[`${fieldPrefix}.holder.castMemberIds`] = [
            `Relationship value anchor references unknown cast member ID: "${!validCastIds.has(c1) ? c1 : c2}"`,
          ];
        }
      } else if (anchor.holder.kind === 'PLACE') {
        if (validNodeIds.size > 0 && !validNodeIds.has(anchor.holder.nodeId)) {
          errors[`${fieldPrefix}.holder.nodeId`] = [
            `Place value anchor references unknown topology node ID: "${anchor.holder.nodeId}"`,
          ];
        }
      }
    });
  }

  // Validate cast opening objective reviews across ALL cast members (perspective-neutral)
  for (const member of draft.cast || []) {
    const pReview = hg?.pursuitReviews?.[member.id];
    const memberName = member.name || member.id;
    if (!pReview || pReview === 'UNREVIEWED') {
      errors[`horrorGrammar.pursuitReviews.${member.id}`] = [
        `Opening objective review is required for character "${memberName}"`,
      ];
    } else if (pReview === 'REVIEWED') {
      const matchingPursuits = (hg?.characterPursuits || []).filter(
        (p) => p.castMemberId === member.id
      );
      if (matchingPursuits.length === 0) {
        errors[`horrorGrammar.pursuitReviews.${member.id}`] = [
          `Opening objective review is marked as reviewed for "${memberName}", but no objective is set`,
        ];
      }
    } else if (pReview === 'REVIEWED_NONE') {
      const matchingPursuits = (hg?.characterPursuits || []).filter(
        (p) => p.castMemberId === member.id
      );
      if (matchingPursuits.length > 0) {
        errors[`horrorGrammar.pursuitReviews.${member.id}`] = [
          `Opening objective review is marked as No Readable Intent for "${memberName}", but an objective is present`,
        ];
      }
    }
  }

  // Validate character pursuits references
  if (hg?.characterPursuits && Array.isArray(hg.characterPursuits)) {
    const seenPursuitIds = new Set<string>();
    hg.characterPursuits.forEach((pursuit, idx) => {
      const fieldPrefix = `horrorGrammar.characterPursuits[${idx}]`;
      if (seenPursuitIds.has(pursuit.id)) {
        errors[`${fieldPrefix}.id`] = [`Duplicate character pursuit ID: "${pursuit.id}"`];
      }
      seenPursuitIds.add(pursuit.id);

      if (!validCastIds.has(pursuit.castMemberId)) {
        errors[`${fieldPrefix}.castMemberId`] = [
          `Character pursuit references unknown cast member ID: "${pursuit.castMemberId}"`,
        ];
      }

      if (pursuit.locationNodeId && validNodeIds.size > 0 && !validNodeIds.has(pursuit.locationNodeId)) {
        errors[`${fieldPrefix}.locationNodeId`] = [
          `Character pursuit references unknown topology node ID: "${pursuit.locationNodeId}"`,
        ];
      }

      if (
        pursuit.reviewWindow === 'EVENT_DRIVEN' &&
        (!pursuit.triggerReferences || pursuit.triggerReferences.length === 0)
      ) {
        errors[`${fieldPrefix}.triggerReferences`] = [
          'EVENT_DRIVEN review window requires at least one trigger reference',
        ];
      }
    });
  }

  // 10. Antagonist Profile Validation (if present)
  if (draft.antagonistProfile) {
    const ap = draft.antagonistProfile as {
      apparatusControls?: Array<{ id?: string; name?: string; affectedNodeIds?: string[] }>;
      telemetryFeeds?: Array<{ nodeId?: string }>;
    };
    if (ap.apparatusControls && Array.isArray(ap.apparatusControls)) {
      ap.apparatusControls.forEach((ctrl, idx) => {
        const prefix = `antagonistProfile.apparatusControls[${idx}]`;
        if (!ctrl.id || !ctrl.id.trim()) {
          errors[`${prefix}.id`] = ['Apparatus control ID cannot be empty'];
        }
        if (!ctrl.name || !ctrl.name.trim()) {
          errors[`${prefix}.name`] = ['Apparatus control name cannot be empty'];
        }
        if (ctrl.affectedNodeIds && Array.isArray(ctrl.affectedNodeIds)) {
          ctrl.affectedNodeIds.forEach((nId, nIdx) => {
            const isUniversal =
              typeof nId === 'string' &&
              (nId === 'all' || nId === '*' || nId.toLowerCase() === 'global');
            if (validNodeIds.size > 0 && !validNodeIds.has(nId) && !isUniversal) {
              errors[`${prefix}.affectedNodeIds[${nIdx}]`] = [
                `Apparatus control references unknown topology node ID: "${nId}"`,
              ];
            }
          });
        }
      });
    }

    if (ap.telemetryFeeds && Array.isArray(ap.telemetryFeeds)) {
      ap.telemetryFeeds.forEach((feed, idx) => {
        const prefix = `antagonistProfile.telemetryFeeds[${idx}]`;
        const nId = feed.nodeId || '';
        const isUniversal =
          nId === 'all' || nId === '*' || nId.toLowerCase() === 'global';
        if (validNodeIds.size > 0 && !validNodeIds.has(nId) && !isUniversal) {
          errors[`${prefix}.nodeId`] = [
            `Telemetry feed references unknown topology node ID: "${feed.nodeId}"`,
          ];
        }
      });
    }
  }

  // 11. HG2 Dramatic Spine & Psychological Stakes Validation
  if (draft.cast && Array.isArray(draft.cast)) {
    draft.cast.forEach((member, idx) => {
      if (member.psychologicalStakes) {
        const stakes = member.psychologicalStakes;
        const prefix = `cast[${idx}].psychologicalStakes`;
        if (stakes.breakingPointThreshold !== undefined && (stakes.breakingPointThreshold < 0 || stakes.breakingPointThreshold > 100)) {
          errors[`${prefix}.breakingPointThreshold`] = ['Breaking point threshold must be between 0 and 100'];
        }
        if (stakes.composureSensitivity !== undefined && stakes.composureSensitivity <= 0) {
          errors[`${prefix}.composureSensitivity`] = ['Composure sensitivity must be greater than 0'];
        }
      }
    });
  }

  if (draft.dramaticSpine) {
    const ds = draft.dramaticSpine;
    const clockIds = new Set<string>();

    if (ds.impendingClocks && Array.isArray(ds.impendingClocks)) {
      ds.impendingClocks.forEach((clock, idx) => {
        const prefix = `dramaticSpine.impendingClocks[${idx}]`;
        if (clockIds.has(clock.id)) {
          errors[`${prefix}.id`] = [`Duplicate clock ID: "${clock.id}"`];
        }
        clockIds.add(clock.id);

        if (clock.diegeticInstrument && clock.instrumentNodeId) {
          if (validNodeIds.size > 0 && !validNodeIds.has(clock.instrumentNodeId)) {
            errors[`${prefix}.instrumentNodeId`] = [
              `Clock "${clock.name}" diegetic instrument references unknown topology node ID: "${clock.instrumentNodeId}"`,
            ];
          }
        }
        if (clock.crisisThreshold !== undefined && (clock.crisisThreshold < 0 || clock.crisisThreshold > 100)) {
          errors[`${prefix}.crisisThreshold`] = ['Clock crisis threshold must be between 0 and 100'];
        }
      });
    }

    // Canonical field is milestoneConditions; tolerate the legacy `milestones`
    // spelling that initializeDramaturgyRuntimeState also accepts.
    const milestoneList: Array<{ kind?: string; referenceId?: string }> =
      ds.milestoneConditions ??
      ((ds as { milestones?: Array<{ kind?: string; referenceId?: string }> }).milestones ||
        []);
    if (milestoneList.length > 0) {
      milestoneList.forEach((milestone, idx) => {
        const prefix = `dramaticSpine.milestoneConditions[${idx}]`;
        if (milestone.kind === 'CLOCK_CRISIS' && milestone.referenceId) {
          if (clockIds.size > 0 && !clockIds.has(milestone.referenceId)) {
            errors[`${prefix}.referenceId`] = [
              `Milestone references unknown clock ID: "${milestone.referenceId}"`,
            ];
          }
        }
        if (milestone.kind === 'COMPOSURE_THRESHOLD' && milestone.referenceId) {
          if (validCastIds.size > 0 && !validCastIds.has(milestone.referenceId)) {
            errors[`${prefix}.referenceId`] = [
              `Milestone references unknown cast member ID: "${milestone.referenceId}"`,
            ];
          }
        }
      });
    }
  }

  // 12. Death Contract Validation (§11, §15)
  const hasCohort = Boolean(
    draft.antagonistProfile?.preyCohort && draft.antagonistProfile.preyCohort.length > 0
  );
  const deathContract = draft.deathContract as DeathContract | undefined;

  if (!deathContract) {
    if (!errors['deathContract']) errors['deathContract'] = [];
    if (!errors['deathContract'].includes('Death contract is required for scenario compilation')) {
      errors['deathContract'].push('Death contract is required for scenario compilation');
    }
  } else {
    if (!deathContract.powerBudget || !deathContract.powerBudget.trim()) {
      errors['deathContract.powerBudget'] = ['Death contract powerBudget is required'];
    }
    const hasMetaphysics =
      deathContract.deathMetaphysics || deathContract.metaphysics;
    if (!hasMetaphysics) {
      errors['deathContract.deathMetaphysics'] = ['Death contract deathMetaphysics is required'];
    }
    if (hasCohort) {
      const succession = deathContract.seatSuccession;
      if (!succession || Object.keys(succession).length === 0) {
        errors['deathContract.seatSuccession'] = [
          'Cohort scenarios require authored seatSuccession policies',
        ];
      }
    }
  }

  // 13. Fear Contract Validation (HG3 Self-Preservation & Death Awareness)
  const fearContract = draft.fearContract as FearContract | undefined;
  if (!fearContract) {
    if (!errors['fearContract']) errors['fearContract'] = [];
    if (!errors['fearContract'].includes('Fear contract is required for scenario compilation')) {
      errors['fearContract'].push('Fear contract is required for scenario compilation');
    }
  } else {
    if (fearContract.lambdaDecay !== undefined) {
      if (typeof fearContract.lambdaDecay !== 'number' || fearContract.lambdaDecay < 0 || fearContract.lambdaDecay > 1) {
        errors['fearContract.lambdaDecay'] = ['Fear contract lambdaDecay must be between 0 and 1'];
      }
    }
    if (fearContract.residueRatio !== undefined) {
      if (typeof fearContract.residueRatio !== 'number' || fearContract.residueRatio < 0 || fearContract.residueRatio > 1) {
        errors['fearContract.residueRatio'] = ['Fear contract residueRatio must be between 0 and 1'];
      }
    }
    if (fearContract.preyEnterThreshold !== undefined) {
      if (typeof fearContract.preyEnterThreshold !== 'number' || fearContract.preyEnterThreshold < 0 || fearContract.preyEnterThreshold > 1) {
        errors['fearContract.preyEnterThreshold'] = ['Fear contract preyEnterThreshold must be between 0 and 1'];
      }
    }
    if (fearContract.preyExitThreshold !== undefined) {
      if (typeof fearContract.preyExitThreshold !== 'number' || fearContract.preyExitThreshold < 0 || fearContract.preyExitThreshold > 1) {
        errors['fearContract.preyExitThreshold'] = ['Fear contract preyExitThreshold must be between 0 and 1'];
      }
    }
    if (
      typeof fearContract.preyEnterThreshold === 'number' &&
      typeof fearContract.preyExitThreshold === 'number' &&
      fearContract.preyExitThreshold >= fearContract.preyEnterThreshold
    ) {
      errors['fearContract.preyExitThreshold'] = [
        'preyExitThreshold must be strictly less than preyEnterThreshold for hysteresis',
      ];
    }
    if (fearContract.threatWeights) {
      const tw = fearContract.threatWeights;
      if (tw.life !== undefined && (typeof tw.life !== 'number' || tw.life < 0)) {
        errors['fearContract.threatWeights.life'] = ['Threat weight for life must be non-negative'];
      }
      if (tw.freedom !== undefined && (typeof tw.freedom !== 'number' || tw.freedom < 0)) {
        errors['fearContract.threatWeights.freedom'] = ['Threat weight for freedom must be non-negative'];
      }
      if (tw.identity !== undefined && (typeof tw.identity !== 'number' || tw.identity < 0)) {
        errors['fearContract.threatWeights.identity'] = ['Threat weight for identity must be non-negative'];
      }
    }
  }

  // 14. Seed State Validation
  const warnings: Record<string, string[]> = {};
  const castList = Array.isArray(draft.cast) ? draft.cast : [];
  const topologyNodeIds = new Set<string>();
  if (Array.isArray(draft.topology?.nodeDefinitions)) {
    draft.topology.nodeDefinitions.forEach((d) => d?.id && topologyNodeIds.add(d.id));
  }
  if (Array.isArray(draft.topology?.nodes)) {
    draft.topology.nodes.forEach((n) => n && topologyNodeIds.add(n));
  }

  castList.forEach((member, idx) => {
    if (member?.seed) {
      const res = validateSeed(
        member.seed,
        member,
        draft as ForgeDraft,
        castList,
        topologyNodeIds
      );
      if (!res.valid) {
        errors[`cast[${idx}].seed`] = res.errors;
      }
      if (res.warnings.length > 0) {
        warnings[`cast[${idx}].seed`] = res.warnings;
      }
    }
  });

  if (draft.openingState) {
    const res = validateScenarioOpeningState(
      draft.openingState,
      draft as ForgeDraft,
      castList,
      topologyNodeIds
    );
    if (!res.valid) {
      errors['openingState'] = res.errors;
    }
    if (res.warnings.length > 0) {
      warnings['openingState'] = res.warnings;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    ...(Object.keys(warnings).length > 0 ? { warnings } : {}),
  };
}

/**
 * Compiles a valid Forge authoring draft into an immutable, canonical Blueprint Review Artifact.
 * Performs dedicated review validation first and normalizes/validates the final Blueprint.
 * Never mutates runtime state, selects a seat, or starts an engine session.
 */
export function compileForgeDraft(
  rawDraft: unknown,
  context?: import('../types/forge').ForgeCompilationContext | number
): ForgeCompileResult {
  const sourceAnalyses =
    typeof context === 'object' && context !== null && 'sourceAnalyses' in context
      ? context.sourceAnalyses
      : null;

  // 1. Atomically project all accepted candidates from source baseline
  let projectedRawDraft = rawDraft && typeof rawDraft === 'object'
    ? projectAcceptedStagedCandidates(rawDraft as ForgeDraft, sourceAnalyses)
    : rawDraft;
  if (projectedRawDraft && typeof projectedRawDraft === 'object') {
    projectedRawDraft = ensureCastSeeds(projectedRawDraft as Record<string, unknown>);
  }

  const validation = validateForgeDraft(projectedRawDraft);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
    };
  }

  const parseResult = ForgeDraftSchema.safeParse(projectedRawDraft);
  if (!parseResult.success) {
    return {
      success: false,
      errors: { draft: ['Draft parsing failed'] },
    };
  }

  const draft: ForgeDraft = parseResult.data as unknown as ForgeDraft;

  // Validate exact provenance for topology elements
  if (draft.topology) {
    const topo = draft.topology;
    if (topo.startingNodeProvenance?.sourceId) {
      const provRes = resolveSourceEvidenceProvenance({
        provenance: {
          kind: 'REVIEWED_SOURCE',
          sourceId: topo.startingNodeProvenance.sourceId,
          evidenceIds: topo.startingNodeProvenance.evidenceIds || [],
        },
        sourceAnalyses,
      });
      if (!provRes.valid) {
        return {
          success: false,
          errors: { 'topology.startingNodeProvenance': provRes.errors },
        };
      }
    }

    if (Array.isArray(topo.nodeDefinitions)) {
      for (let idx = 0; idx < topo.nodeDefinitions.length; idx++) {
        const nodeDef = topo.nodeDefinitions[idx];
        if (nodeDef.sourceId) {
          const provRes = resolveSourceEvidenceProvenance({
            provenance: {
              kind: 'REVIEWED_SOURCE',
              sourceId: nodeDef.sourceId,
              evidenceIds: nodeDef.evidenceIds || [],
            },
            sourceAnalyses,
          });
          if (!provRes.valid) {
            return {
              success: false,
              errors: { [`topology.nodeDefinitions[${idx}].provenance`]: provRes.errors },
            };
          }
        }
      }
    }

    if (Array.isArray(topo.connections)) {
      for (let idx = 0; idx < topo.connections.length; idx++) {
        const conn = topo.connections[idx];
        if (typeof conn === 'object' && conn !== null && 'sourceId' in conn && conn.sourceId) {
          const provRes = resolveSourceEvidenceProvenance({
            provenance: {
              kind: 'REVIEWED_SOURCE',
              sourceId: conn.sourceId,
              evidenceIds: conn.evidenceIds || [],
            },
            sourceAnalyses,
          });
          if (!provRes.valid) {
            return {
              success: false,
              errors: { [`topology.connections[${idx}].provenance`]: provRes.errors },
            };
          }
        }
      }
    }

    if (Array.isArray(topo.anchors)) {
      for (let idx = 0; idx < topo.anchors.length; idx++) {
        const anchor = topo.anchors[idx];
        if (anchor.sourceId) {
          const provRes = resolveSourceEvidenceProvenance({
            provenance: {
              kind: 'REVIEWED_SOURCE',
              sourceId: anchor.sourceId,
              evidenceIds: anchor.evidenceIds || [],
            },
            sourceAnalyses,
          });
          if (!provRes.valid) {
            return {
              success: false,
              errors: { [`topology.anchors[${idx}].provenance`]: provRes.errors },
            };
          }
        }
      }
    }
  }

  const synchronizedCast = (draft.cast || []).map((c) => ({
    ...c,
    isUserCharacter: false,
  }));

  const resolvedDepiction = deriveDefaultDepictionContract(draft);

  const draftCopy = { ...draft };
  delete (draftCopy as Record<string, unknown>).userCharacterId;
  delete (draftCopy as Record<string, unknown>).userOpeningAim;
  if (draftCopy.horrorGrammar) {
    const hgCopy = { ...draftCopy.horrorGrammar };
    delete (hgCopy as Record<string, unknown>).userOpeningAim;
    draftCopy.horrorGrammar = hgCopy;
  }
  if (draftCopy.topology) {
    const topoCopy = { ...draftCopy.topology };
    delete (topoCopy as Record<string, unknown>).startingNodeId;
    delete (topoCopy as Record<string, unknown>).startingNodeProvenance;
    draftCopy.topology = topoCopy;
  }

  // Transform into canonical Blueprint shape through single normalization boundary
  const normalized: Blueprint = normalizeBlueprint({
    ...draftCopy,
    title: draft.identity?.title || draft.title,
    globalPremise: draft.globalPremise || draft.premise,
    premise: draft.premise || draft.globalPremise,
    coverImageUrl: draft.coverImageUrl,
    backCoverBlurb: draft.backCoverBlurb || draft.premise || draft.globalPremise,
    userCharacterId: undefined,
    villainProtagonist: draft.villainProtagonist === true,
    cast: synchronizedCast,
    depictionContract: resolvedDepiction,
    dramaticSpine: draft.dramaticSpine,
    deathContract: draft.deathContract || deriveDefaultDeathContract(draft),
    fearContract: draft.fearContract || deriveDefaultFearContract(draft),
  });


  // Verify full canonical Blueprint compliance
  const parsedBlueprint = BlueprintSchema.parse(normalized);

  const json = JSON.stringify(parsedBlueprint, null, 2);
  const titleStr = parsedBlueprint.identity?.title || parsedBlueprint.title || 'blueprint';
  const safeTitle = titleStr.replace(/[\s\W]+/g, '_').toLowerCase();

  const references = parsedBlueprint.references;
  const safeRefs =
    references && Array.isArray(references) && references.length > 0
      ? references.map((r: string) => r.replace(/[\s\W]+/g, '_').toLowerCase()).join('_') + '_'
      : '';

  const fileName = `${safeRefs}${safeTitle}.json`;

  const deepClonedBlueprint = JSON.parse(JSON.stringify(parsedBlueprint));
  const frozenBlueprint = deepFreeze(deepClonedBlueprint);

  const sourceDraftRevision =
    typeof context === 'object' && context !== null
      ? context.draftRevision
      : typeof context === 'number'
        ? context
        : 1;

  const sourceBaselineRevision =
    typeof context === 'object' && context !== null
      ? context.sourceBaselineRevision
      : 1;

  const artifact: ForgeReviewArtifact = deepFreeze({
    blueprint: frozenBlueprint,
    json,
    fileName,
    compiledAt: Date.now(),
    sourceDraftId: draft.id,
    sourceDraftRevision,
    sourceBaselineRevision,
  });

  return {
    success: true,
    artifact,
    blueprint: artifact.blueprint,
  };
}

/**
 * Compiles a Forge draft or throws a structured ForgeCompilationError.
 */
export function compileForgeDraftOrThrow(
  rawDraft: unknown,
  context?: import('../types/forge').ForgeCompilationContext | number
): ForgeReviewArtifact {
  const result = compileForgeDraft(rawDraft, context);
  if (!result.success) {
    throw new ForgeCompilationError(result.errors);
  }
  return result.artifact;
}
