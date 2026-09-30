import { Blueprint, CastMember, ParticipationContext, ParticipationMode, normalizeParticipationContext } from '../types';
import { MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH, VictimField } from '../types/participation';
import { isVillainCastMember, isOppositionCastMember, findVillainCastMember } from './castVillain';

export interface SeatAvailability {
  role: ParticipationMode;
  available: boolean;
  reason?: string;
  boundCharacterId?: string | null;
  boundCharacterName?: string | null;
}

/**
 * Shared helper to build victim fields for predatory characters (human villains and villain-protagonists).
 */
export function buildVictimFieldForPredator(cast: CastMember[], predatorId?: string): VictimField | undefined {
  const otherCast = cast.filter((c) => c.id !== predatorId);
  if (otherCast.length === 0) return undefined;
  return {
    kind: 'group',
    collectiveDesignation: 'Potential Victims & Bystanders',
    description: 'Other individuals present in the environment.',
    members: otherCast.map((c) => ({
      id: c.id,
      name: c.name,
      description: (c.description || c.role || 'Unaware subject').trim().slice(0, 300),
      goal: (c.goals || 'Maintain normal life and social standing').trim().slice(0, 200),
      knownFact: `Traits: ${(c.traits || []).join(', ')}`.trim().slice(0, 200),
    })),
  };
}

/**
 * Pure resolver to determine seat availability for Protagonist, Antagonist, and Director
 * based on the provided Scenario Blueprint.
 */
export function resolveSeatAvailabilities(
  blueprint: Blueprint
): Record<ParticipationMode, SeatAvailability> {
  const cast = blueprint.cast || [];

  if (blueprint.villainProtagonist === true) {
    const villainProtagonistMember =
      cast.find((c) => c.isUserCharacter && isVillainCastMember(c)) ||
      (blueprint.defaultVillainId
        ? findVillainCastMember(cast, blueprint.defaultVillainId)
        : undefined) ||
      cast.find((c) => !c.isEntity && c.disposition === 'VILLAIN') ||
      cast.find(isVillainCastMember);

    const protagonistAvailable = Boolean(villainProtagonistMember);

    const oppositionMember = cast.find(isOppositionCastMember);
    const antagonistAvailable = Boolean(oppositionMember);

    const survivorMember =
      cast.find((c) => !c.isEntity && c.disposition !== 'VILLAIN') ||
      cast.find((c) => !c.isEntity);
    const survivorAvailable = Boolean(survivorMember);

    const bystanderMember =
      cast.find((c) => c.disposition === 'BYSTANDER') || survivorMember;
    const bystanderAvailable = Boolean(bystanderMember);

    return {
      protagonist: {
        role: 'protagonist',
        available: protagonistAvailable,
        reason: protagonistAvailable
          ? undefined
          : 'Villain-protagonist mode is set but no villain cast member exists.',
        boundCharacterId: villainProtagonistMember ? villainProtagonistMember.id : null,
        boundCharacterName: villainProtagonistMember ? villainProtagonistMember.name : null,
      },
      survivor: {
        role: 'survivor',
        available: survivorAvailable,
        reason: survivorAvailable
          ? undefined
          : 'No mortal survivor cast member found in blueprint.',
        boundCharacterId: survivorMember ? survivorMember.id : null,
        boundCharacterName: survivorMember ? survivorMember.name : null,
      },
      antagonist: {
        role: 'antagonist',
        available: antagonistAvailable,
        reason: antagonistAvailable
          ? undefined
          : 'The villain is the protagonist; no separate opposition figure exists in cast.',
        boundCharacterId: oppositionMember ? oppositionMember.id : null,
        boundCharacterName: oppositionMember ? oppositionMember.name : null,
      },
      villain: {
        role: 'villain',
        available: protagonistAvailable,
        reason: protagonistAvailable
          ? undefined
          : 'No villain, entity, or predator profile found in blueprint.',
        boundCharacterId: villainProtagonistMember ? villainProtagonistMember.id : null,
        boundCharacterName: villainProtagonistMember ? villainProtagonistMember.name : null,
      },
      bystander: {
        role: 'bystander',
        available: bystanderAvailable,
        reason: bystanderAvailable
          ? undefined
          : 'No bystander or civilian cast member found in blueprint.',
        boundCharacterId: bystanderMember ? bystanderMember.id : null,
        boundCharacterName: bystanderMember ? bystanderMember.name : null,
      },
      director: {
        role: 'director',
        available: true,
        reason: undefined,
        boundCharacterId: null,
        boundCharacterName: 'Director',
      },
    };
  }

  // Protagonist / Survivor: Requires a viable mortal cast member (isEntity !== true and disposition !== 'VILLAIN')
  const mortalMember =
    cast.find((c) => !c.isEntity && c.disposition !== 'VILLAIN') ||
    cast.find((c) => !c.isEntity);
  const protagonistAvailable = Boolean(mortalMember);

  // Antagonist / Villain: Requires an entity cast member, explicit antagonist perspective, antagonist haunted house provenance, an antagonistProfile, or a cast member with disposition === 'VILLAIN'
  const villainMember = cast.find(isVillainCastMember);
  const entityMember = cast.find(
    (c) => c.isEntity === true || String(c.role).toUpperCase() === 'ANTAGONIST'
  );
  const hasAntagonistPerspective = blueprint.perspectives?.some(
    (p) =>
      String(p.role).toUpperCase() === 'ANTAGONIST' ||
      String(p.role).toUpperCase() === 'VILLAIN'
  );
  const hasAntagonistProvenance =
    blueprint.hauntedHouse?.recommendedParticipationMode === 'antagonist' ||
    blueprint.hauntedHouse?.participationContext?.mode === 'antagonist' ||
    (blueprint.hauntedHouse?.recommendedParticipationMode as unknown as string) === 'villain' ||
    (blueprint.hauntedHouse?.participationContext?.mode as unknown as string) === 'villain';
  const antagonistAvailable = Boolean(
    entityMember ||
      villainMember ||
      hasAntagonistPerspective ||
      hasAntagonistProvenance
  );

  // Bystander: Requires a cast member with disposition === 'BYSTANDER', or any mortal cast member
  const bystanderMember =
    cast.find((c) => c.disposition === 'BYSTANDER') || mortalMember;
  const bystanderAvailable = Boolean(bystanderMember);

  const chosenVillain = villainMember || entityMember;
  const villainName = chosenVillain
    ? chosenVillain.name
    : blueprint.hauntedHouse?.participationContext?.seat?.name ||
      blueprint.antagonistProfile?.name ||
      'Opposition Force';

  return {
    protagonist: {
      role: 'protagonist',
      available: protagonistAvailable,
      reason: protagonistAvailable
        ? undefined
        : 'No mortal protagonist cast member found in blueprint.',
      boundCharacterId: mortalMember ? mortalMember.id : null,
      boundCharacterName: mortalMember ? mortalMember.name : null,
    },
    survivor: {
      role: 'survivor',
      available: protagonistAvailable,
      reason: protagonistAvailable
        ? undefined
        : 'No mortal survivor cast member found in blueprint.',
      boundCharacterId: mortalMember ? mortalMember.id : null,
      boundCharacterName: mortalMember ? mortalMember.name : null,
    },
    antagonist: {
      role: 'antagonist',
      available: antagonistAvailable,
      reason: antagonistAvailable
        ? undefined
        : 'No antagonist entity or opposition authority found in blueprint.',
      boundCharacterId: chosenVillain ? chosenVillain.id : null,
      boundCharacterName: villainName,
    },
    villain: {
      role: 'villain',
      available: antagonistAvailable,
      reason: antagonistAvailable
        ? undefined
        : 'No villain, entity, or predator profile found in blueprint.',
      boundCharacterId: chosenVillain ? chosenVillain.id : null,
      boundCharacterName: villainName,
    },
    bystander: {
      role: 'bystander',
      available: bystanderAvailable,
      reason: bystanderAvailable
        ? undefined
        : 'No bystander or civilian cast member found in blueprint.',
      boundCharacterId: bystanderMember ? bystanderMember.id : null,
      boundCharacterName: bystanderMember ? bystanderMember.name : null,
    },
    director: {
      role: 'director',
      available: true,
      reason: undefined,
      boundCharacterId: null,
      boundCharacterName: 'Director',
    },
  };
}

/**
 * Builds an active participation context for the selected role without mutating
 * or corrupting the scenario's stored provenance.
 */
export function buildActiveParticipationContext(
  blueprint: Blueprint,
  selectedRole: ParticipationMode,
  resolvedCharacterId?: string | null
): ParticipationContext | null {
  const cast = blueprint.cast || [];

  if (selectedRole === 'director') {
    const existing =
      blueprint.hauntedHouse?.participationContext?.mode === 'director'
        ? normalizeParticipationContext(blueprint.hauntedHouse.participationContext)
        : null;

    if (existing) {
      return {
        ...existing,
        mode: 'director',
        seat: {
          ...existing.seat,
          kind: 'director',
          name: 'Director',
        },
      };
    }

    return {
      mode: 'director',
      seat: {
        kind: 'director',
        name: 'Director',
        description: 'External Narrative Framing & Pacing Authority',
      },
      initialGoal:
        blueprint.globalPremise ||
        blueprint.setting?.location ||
        'Direct scene pacing, tension, and dramatic withholding.',
      boundedFacts: [
        `Location: ${blueprint.setting?.location || 'Unknown'}`.trim().slice(0, 250),
        `Atmosphere: ${blueprint.setting?.atmosphere || 'Staged narrative enclosure'}`.trim().slice(0, 250),
      ].slice(0, 8),
    };
  }

  // Find exact resolved cast member if resolvedCharacterId is supplied
  let boundMember =
    resolvedCharacterId !== undefined
      ? resolvedCharacterId !== null
        ? cast.find((c) => c.id === resolvedCharacterId)
        : null
      : undefined;

  if (selectedRole === 'protagonist' || selectedRole === 'survivor') {
    if (boundMember === undefined) {
      if (selectedRole === 'protagonist' && blueprint.villainProtagonist === true) {
        boundMember =
          cast.find((c) => c.isUserCharacter && isVillainCastMember(c)) ||
          (blueprint.defaultVillainId
            ? findVillainCastMember(cast, blueprint.defaultVillainId)
            : undefined) ||
          cast.find((c) => !c.isEntity && c.disposition === 'VILLAIN') ||
          cast.find(isVillainCastMember);
      } else {
        boundMember =
          cast.find((c) => !c.isEntity && c.disposition !== 'VILLAIN') ||
          cast.find((c) => !c.isEntity);
      }
    }

    const name =
      boundMember?.name ||
      (selectedRole === 'survivor' ? 'Survivor' : 'Protagonist');

    const isVillainProtagonist =
      selectedRole === 'protagonist' &&
      blueprint.villainProtagonist === true &&
      Boolean(boundMember && isVillainCastMember(boundMember));

    if (isVillainProtagonist) {
      const initialGoal =
        boundMember?.goals?.trim()
          ? boundMember.goals.trim()
          : 'Sate the compulsion. Maintain the mask. Leave no evidence.';
      const motiveLine = boundMember?.goals?.trim()
        ? `Motive: ${boundMember.goals.trim()}`
        : 'Motive: Predatory / Psychopathic impulse';
      const boundedFacts = [
        `Location: ${blueprint.setting?.location || 'Unknown'}`,
        `Identity: ${name}`,
        'Social Camouflage: Active',
        motiveLine,
      ].slice(0, 8);
      const victimField = buildVictimFieldForPredator(cast, boundMember?.id);

      return normalizeParticipationContext({
        mode: 'protagonist',
        seat: {
          kind: 'protagonist',
          name,
          description: boundMember?.description?.trim().slice(0, MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH),
        },
        initialGoal,
        boundedFacts,
        victimField,
      });
    }

    const existing =
      blueprint.hauntedHouse?.participationContext?.mode === 'protagonist' ||
      (blueprint.hauntedHouse?.participationContext?.mode as unknown as string) === 'survivor'
        ? normalizeParticipationContext(
            blueprint.hauntedHouse.participationContext
          )
        : null;

    if (existing) {
      return {
        ...existing,
        mode: selectedRole,
        seat: {
          ...existing.seat,
          kind: selectedRole === 'survivor' ? 'survivor' : 'protagonist',
          name: boundMember ? boundMember.name : existing.seat?.name || name,
          description: boundMember
            ? boundMember.description?.trim().slice(0, MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH)
            : existing.seat?.description,
        },
      };
    }

    return {
      mode: selectedRole,
      seat: {
        kind: selectedRole === 'survivor' ? 'survivor' : 'protagonist',
        name,
        description: boundMember?.description?.trim().slice(0, MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH),
      },
      initialGoal:
        blueprint.narrativeRules?.incitingIncident ||
        blueprint.globalPremise ||
        `Investigate and survive ${blueprint.setting?.location || 'the enclosure'}.`,
      boundedFacts: [
        `Location: ${blueprint.setting?.location || 'Unknown'}`,
        `Identity: ${name}`,
      ].slice(0, 8),
    };
  }

  if (selectedRole === 'antagonist' || selectedRole === 'villain') {
    if (boundMember === undefined) {
      if (selectedRole === 'antagonist' && blueprint.villainProtagonist === true) {
        boundMember = cast.find(isOppositionCastMember);
      } else {
        boundMember = cast.find(isVillainCastMember);
      }
    }

    const isOpposition =
      selectedRole === 'antagonist' &&
      blueprint.villainProtagonist === true &&
      Boolean(boundMember && isOppositionCastMember(boundMember));

    if (isOpposition) {
      const name = boundMember?.name || 'Opposition Force';
      const authorityText =
        'Authorized to investigate, gather evidence, interrogate, and pursue lawful apprehension of the suspect.';
      const limitsText =
        'Bound by evidence, procedure, and reasonable doubt. Human: no supernatural reach.';
      const initialGoal =
        boundMember?.goals?.trim() ||
        'Expose the perpetrator. Build a case that holds.';

      return normalizeParticipationContext({
        mode: 'antagonist',
        seat: {
          kind: 'character',
          name,
          description: boundMember?.description?.trim().slice(0, MAX_PARTICIPATION_SEAT_DESCRIPTION_LENGTH),
          ability: authorityText,
          limitation: limitsText,
        },
        initialGoal,
        boundedFacts: [
          `Location: ${blueprint.setting?.location || 'Unknown'}`,
          `Role: Opposition Force (${name})`,
          'Authority: Law Enforcement / Investigative',
        ].slice(0, 8),
        authorityContract: {
          authority: authorityText,
          limits: limitsText,
        },
      });
    }

    const ap = blueprint.antagonistProfile;
    const isHumanVillain = Boolean(
      boundMember &&
        !boundMember.isEntity &&
        boundMember.disposition === 'VILLAIN'
    );
    const name =
      boundMember?.name ||
      ap?.name ||
      (selectedRole === 'villain' ? 'Villain' : 'Opposition Force');
    const isForce = ap ? ap.kind === 'FORCE' : !boundMember;

    const authorityText = isHumanVillain
      ? `Authorized to stalk, deceive, manipulate, and execute homicidal or predatory actions within social and physical limits.`
      : ap && ap.apparatusControls.length > 0
      ? `Authorized to actuate facility apparatus across nodes: ${ap.apparatusControls
          .map(
            (c) =>
              `${c.name} [${c.kind}] affecting (${c.affectedNodeIds.join(', ') || 'all'}) with actions: ${c.availableActions.join(', ')}`
          )
          .join('; ')}`
      : 'Authored scenario apparatus and environmental reach.';

    const limitsText = isHumanVillain
      ? `Bound by physical human anatomy, social exposure risk, and investigative evidence trails.`
      : ap && ap.sadisticDirectives.length > 0
      ? `Operational boundaries & directives: ${ap.sadisticDirectives.join('; ')}`
      : 'Bounded strictly to scenario rules and apparatus reach.';

    let victimField: VictimField | undefined = undefined;
    if (isHumanVillain) {
      victimField = buildVictimFieldForPredator(cast, boundMember?.id);
    } else if (ap && ap.preyCohort.length > 0) {
      if (ap.preyCohort.length === 1) {
        const p = ap.preyCohort[0];
        victimField = {
          kind: 'individual',
          name: p.name,
          description: `Vulnerabilities: ${p.vulnerabilities.join(', ')}`,
          goal: 'Survive and escape enclosure.',
          knownFact: `Breaking point: ${p.breakingPoint}`,
        };
      } else {
        victimField = {
          kind: 'group',
          collectiveDesignation: 'Trapped Subjects / Prey Cohort',
          description: 'Autonomous mortal survivors trapped within enclosure.',
          members: ap.preyCohort.map((p) => ({
            id: p.id,
            name: p.name,
            description: `Vulnerabilities: ${p.vulnerabilities.join(', ')}`,
            goal: 'Survive and escape enclosure.',
            knownFact: `Breaking point: ${p.breakingPoint}`,
          })),
        };
      }
    }

    const boundedFacts: string[] = [
      `Location: ${blueprint.setting?.location || 'Unknown'}`,
      `Role: ${selectedRole === 'villain' ? 'Predatory Villain' : 'Antagonist Force'} (${name})`,
      ...(isHumanVillain
        ? [
            'Social Camouflage: Active',
            'Motive: Predatory / Psychopathic impulse',
          ]
        : []),
    ];
    if (ap?.sadisticDirectives) {
      ap.sadisticDirectives.forEach((d) => {
        if (boundedFacts.length < 8) boundedFacts.push(`Directive: ${d}`);
      });
    }

    return normalizeParticipationContext({
      mode: selectedRole,
      seat: {
        kind: isForce ? 'force' : 'character',
        name,
        description:
          boundMember?.description ||
          (ap
            ? `Autonomous ${ap.kind.toLowerCase()} controlling enclosure subsystems.`
            : undefined),
        ability: authorityText,
        limitation: limitsText,
      },
      initialGoal:
        boundMember?.goals ||
        blueprint.narrativeRules?.incitingIncident ||
        blueprint.globalPremise ||
        'Enforce predatory intent and victim containment.',
      boundedFacts: boundedFacts.slice(0, 8),
      authorityContract: {
        authority: authorityText,
        limits: limitsText,
      },
      victimField,
    });
  }

  if (selectedRole === 'bystander') {
    if (boundMember === undefined) {
      boundMember =
        cast.find((c) => c.disposition === 'BYSTANDER') ||
        cast.find((c) => !c.isEntity && c.disposition !== 'VILLAIN') ||
        cast.find((c) => !c.isEntity);
    }

    const name = boundMember?.name || 'Bystander';
    return {
      mode: 'bystander',
      seat: {
        kind: 'bystander',
        name,
        description:
          boundMember?.description ||
          'Civilian bystander trying to mind their own business.',
      },
      initialGoal:
        boundMember?.goals ||
        'Mind your own business, attend to your daily tasks, and avoid getting dragged into bizarre horror situations.',
      boundedFacts: [
        `Location: ${blueprint.setting?.location || 'Unknown'}`,
        `Identity: ${name}`,
        `Mindset: Civilian self-preservation and mundane pragmatism`,
      ].slice(0, 8),
    };
  }

  return null;
}
