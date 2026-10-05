import React, { useRef, useState, useMemo } from 'react';
import {
  ArrowLeft,
  Upload,
  AlertCircle,
  AlertTriangle,
  Users,
  Shield,
  Skull,
  Activity,
  Play,
  Sparkles,
  Film,
  Lock,
  FlaskConical,
  Coffee,
} from 'lucide-react';
import blackIronMortuary from '../../data/blueprints/black_iron_mortuary.json';
import silverRestLodge from '../../data/blueprints/silver_rest_lodge.json';
import theRefinement from '../../data/blueprints/the_refinement.json';
import { useAppStore } from '../../store/useAppStore';
import { useEngineStore } from '../../core/store';
import { forgeActions, useForgeState } from '../../store/useForgeStore';
import { Blueprint, ParticipationMode } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';
import {
  resolveSeatAvailabilities,
  buildActiveParticipationContext,
  isVillainCastMember,
} from '../../lib/seatAvailability';
import {
  isCharacterEligibleForRole,
  resolvePerspectiveBinding,
} from '../../lib/playerCharacterBinding';
import { motion, AnimatePresence } from 'motion/react';
import AdLibInductionModal from './AdLibInductionModal';

interface EngineSetupProps {
  onContinue?: () => void;
}

export default function EngineSetup({ onContinue }: EngineSetupProps) {
  const setPhase = useAppStore((state) => state.setPhase);
  const activeCharacterId = useForgeState((state) => state.activeCharacterId);
  const activeBlueprint = useEngineStore((state) => state.activeBlueprint);
  const setBlueprint = useEngineStore((state) => state.setBlueprint);
  const [error, setError] = useState<string | null>(null);
  const [previewBlueprint, setPreviewBlueprint] = useState<Blueprint | null>(null);
  const [selectedRole, setSelectedRole] = useState<ParticipationMode | null>(null);
  const [isAdLibModalOpen, setIsAdLibModalOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute seat availabilities for loaded blueprint
  const seatAvailabilities = useMemo(() => {
    return previewBlueprint ? resolveSeatAvailabilities(previewBlueprint) : null;
  }, [previewBlueprint]);

  const isRecommendedSeatUnavailable = useMemo(() => {
    if (!previewBlueprint?.hauntedHouse?.recommendedParticipationMode || !seatAvailabilities) {
      return false;
    }
    const rec = previewBlueprint.hauntedHouse.recommendedParticipationMode;
    return !seatAvailabilities[rec]?.available;
  }, [previewBlueprint, seatAvailabilities]);

  const handleSelectRole = (newRole: ParticipationMode | null) => {
    setSelectedRole(newRole);
    if (!activeCharacterId) return;
    if (!newRole || newRole === 'director') {
      forgeActions.setActiveCharacterId(null);
      return;
    }
    const selectedChar = previewBlueprint?.cast?.find((c) => c.id === activeCharacterId);
    if (!selectedChar || !isCharacterEligibleForRole(selectedChar, newRole)) {
      forgeActions.setActiveCharacterId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed: unknown = JSON.parse(content);

        try {
          const validated = normalizeBlueprint(parsed);
          setPreviewBlueprint(validated);
          if (validated.userCharacterId) {
            forgeActions.setActiveCharacterId(validated.userCharacterId);
          } else {
            forgeActions.setActiveCharacterId(null);
          }

          const availabilities = resolveSeatAvailabilities(validated);
          if (validated.hauntedHouse) {
            const rec = validated.hauntedHouse.recommendedParticipationMode;
            if (availabilities[rec]?.available) {
              setSelectedRole(rec);
            } else {
              // Incompatible recommended seat: do not silently fall back. User must select explicitly.
              setSelectedRole(null);
            }
            return;
          }

          // Legacy blueprint without Haunted House provenance: retain standard fallback selection
          if (availabilities.protagonist?.available) {
            setSelectedRole('protagonist');
          } else if (availabilities.antagonist?.available) {
            setSelectedRole('antagonist');
          } else if (availabilities.director?.available) {
            setSelectedRole('director');
          } else {
            setSelectedRole(null);
          }
        } catch (validationErr: unknown) {
          console.error('Zod Validation Failed:', validationErr);
          const errorMsg =
            validationErr instanceof Error ? validationErr.message : String(validationErr);
          setError(`INVALID BLUEPRINT SCHEMA: ${errorMsg}`);
        }
      } catch (err) {
        setError('PARSING ERROR: FILE CORRUPTED OR NOT VALID JSON');
        console.error('Blueprint load error:', err);
      }
    };

    reader.onerror = () => {
      setError('READ ERROR: SYSTEM UNABLE TO ACCESS FILE');
    };

    reader.readAsText(file);
  };

  const handleLoadBespokeBlueprint = () => {
    try {
      const validated = normalizeBlueprint(blackIronMortuary);
      setPreviewBlueprint(validated);
      if (validated.userCharacterId) {
        forgeActions.setActiveCharacterId(validated.userCharacterId);
      } else {
        forgeActions.setActiveCharacterId(null);
      }

      const availabilities = resolveSeatAvailabilities(validated);
      if (availabilities.protagonist?.available) {
        setSelectedRole('protagonist');
      } else if (availabilities.antagonist?.available) {
        setSelectedRole('antagonist');
      } else if (availabilities.director?.available) {
        setSelectedRole('director');
      } else {
        setSelectedRole(null);
      }
      setError(null);
    } catch (err: unknown) {
      console.error('Failed to load bespoke blueprint:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`FAILED TO LOAD BESPOKE SCENARIO: ${msg}`);
    }
  };

  const handleLoadSilverRestBlueprint = () => {
    try {
      const validated = normalizeBlueprint(silverRestLodge);
      setPreviewBlueprint(validated);
      if (validated.userCharacterId) {
        forgeActions.setActiveCharacterId(validated.userCharacterId);
      } else {
        forgeActions.setActiveCharacterId(null);
      }

      const availabilities = resolveSeatAvailabilities(validated);
      if (availabilities.protagonist?.available) {
        setSelectedRole('protagonist');
      } else if (availabilities.antagonist?.available) {
        setSelectedRole('antagonist');
      } else if (availabilities.director?.available) {
        setSelectedRole('director');
      } else {
        setSelectedRole(null);
      }
      setError(null);
    } catch (err: unknown) {
      console.error('Failed to load Silver Rest Lodge blueprint:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`FAILED TO LOAD BESPOKE SCENARIO: ${msg}`);
    }
  };

  const handleLoadTheRefinementBlueprint = () => {
    try {
      const validated = normalizeBlueprint(theRefinement);
      setPreviewBlueprint(validated);
      if (validated.userCharacterId) {
        forgeActions.setActiveCharacterId(validated.userCharacterId);
      } else {
        forgeActions.setActiveCharacterId(null);
      }

      const availabilities = resolveSeatAvailabilities(validated);
      if (availabilities.protagonist?.available) {
        setSelectedRole('protagonist');
      } else if (availabilities.antagonist?.available) {
        setSelectedRole('antagonist');
      } else if (availabilities.director?.available) {
        setSelectedRole('director');
      } else {
        setSelectedRole(null);
      }
      setError(null);
    } catch (err: unknown) {
      console.error('Failed to load The Refinement blueprint:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`FAILED TO LOAD BESPOKE SCENARIO: ${msg}`);
    }
  };

  const handleStart = () => {
    if (!previewBlueprint || !selectedRole) return;
    if (!isRoleAvailable(selectedRole)) return;

    if ((selectedRole === 'villain' || selectedRole === 'antagonist') && !activeCharacterId) {
      const villainCount = (previewBlueprint.cast ?? []).filter(isVillainCastMember).length;
      if (villainCount > 1) {
        setError('Select a villain from the cast dossier before initializing.');
        return;
      }
    }

    // 1. Resolve binding and validate BEFORE any store mutation
    let binding;
    try {
      binding = resolvePerspectiveBinding(
        previewBlueprint,
        selectedRole,
        activeCharacterId ?? undefined
      );
    } catch (bindErr) {
      const msg = bindErr instanceof Error ? bindErr.message : String(bindErr);
      setError(`BINDING ERROR: ${msg}`);
      return;
    }

    const activeContext = buildActiveParticipationContext(
      previewBlueprint,
      selectedRole,
      binding.characterId
    );

    const neuralLink =
      selectedRole === 'director'
        ? 'DIRECTOR'
        : selectedRole === 'antagonist' || selectedRole === 'villain'
        ? 'ANTAGONIST'
        : 'PROTAGONIST';

    forgeActions.setActiveNeuralLink(neuralLink);
    forgeActions.startSimulation(previewBlueprint);
    setBlueprint(previewBlueprint, selectedRole, activeContext, binding.characterId ?? undefined);
  };

  const isRoleAvailable = (role: ParticipationMode) => {
    return seatAvailabilities ? seatAvailabilities[role]?.available : true;
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col p-6 sm:p-8 font-mono selection:bg-white selection:text-black">
      <header className="flex items-center justify-between mb-8 sm:mb-12">
        <button
          onClick={() => (previewBlueprint ? setPreviewBlueprint(null) : setPhase('hub'))}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors uppercase text-xs tracking-[0.2em] cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {previewBlueprint ? 'Cancel Initialization' : 'Return to Hub'}
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-zinc-400">
          The Engine // Setup
        </h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {!previewBlueprint ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full space-y-10"
            >
              <div className="text-center space-y-3">
                <h2 className="text-2xl sm:text-3xl font-light tracking-widest uppercase text-white">
                  Initialize Simulation
                </h2>
                <p className="text-zinc-400 text-xs sm:text-sm tracking-tight uppercase leading-relaxed">
                  Start a procedural Haunted House session, load a blueprint, or resume active link.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Option 1: Continue */}
                <button
                  onClick={onContinue}
                  disabled={!activeBlueprint}
                  className={`p-8 border flex flex-col items-center justify-center gap-4 transition-all duration-500 rounded group ${
                    activeBlueprint
                      ? 'border-white bg-white/5 hover:bg-white/10 cursor-pointer'
                      : 'border-zinc-900 opacity-30 cursor-not-allowed'
                  }`}
                >
                  <Activity
                    className={`w-10 h-10 ${activeBlueprint ? 'text-white animate-pulse' : 'text-zinc-700'}`}
                  />
                  <div className="text-center space-y-1">
                    <span className="text-xs uppercase tracking-[0.25em] block font-bold text-white">
                      Resume Link
                    </span>
                    <span className="text-xs text-zinc-400 uppercase tracking-wider block">
                      {activeBlueprint ? `Active: ${activeBlueprint.title}` : 'No Active Session'}
                    </span>
                  </div>
                </button>

                {/* Option 2: Upload New */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-8 border-2 border-dashed border-zinc-800 hover:border-zinc-500 transition-all duration-500 bg-zinc-950/40 rounded flex flex-col items-center justify-center cursor-pointer group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".json"
                    className="hidden"
                  />
                  <Upload className="w-10 h-10 text-zinc-600 group-hover:text-white transition-colors mb-3" />
                  <div className="text-center space-y-1">
                    <span className="text-xs uppercase tracking-[0.25em] block font-bold text-white">
                      Upload Blueprint
                    </span>
                    <span className="text-xs text-zinc-400 uppercase tracking-wider block">
                      Import structured JSON or scenario
                    </span>
                  </div>
                </div>

                {/* Option 3: Bespoke Test Scenario */}
                <div
                  onClick={handleLoadBespokeBlueprint}
                  className="p-8 border border-amber-900/50 hover:border-amber-500/80 transition-all duration-500 bg-zinc-950/60 hover:bg-amber-950/15 rounded flex flex-col items-center justify-center cursor-pointer group"
                >
                  <FlaskConical className="w-10 h-10 text-amber-500/70 group-hover:text-amber-400 transition-colors mb-3" />
                  <div className="text-center space-y-1">
                    <span className="text-xs uppercase tracking-[0.25em] block font-bold text-white">
                      Black Iron Mortuary
                    </span>
                    <span className="text-xs text-amber-400/80 uppercase tracking-wider block text-[10px]">
                      Bespoke Clinical Test Blueprint
                    </span>
                  </div>
                </div>

                {/* Option 3b: Social Horror Interaction Scenario */}
                <div
                  onClick={handleLoadSilverRestBlueprint}
                  className="p-8 border border-amber-900/50 hover:border-amber-500/80 transition-all duration-500 bg-zinc-950/60 hover:bg-amber-950/15 rounded flex flex-col items-center justify-center cursor-pointer group"
                >
                  <Users className="w-10 h-10 text-amber-500/70 group-hover:text-amber-400 transition-colors mb-3" />
                  <div className="text-center space-y-1">
                    <span className="text-xs uppercase tracking-[0.25em] block font-bold text-white">
                      The Silver Rest Lodge
                    </span>
                    <span className="text-xs text-amber-400/80 uppercase tracking-wider block text-[10px]">
                      Social Horror Interaction Blueprint
                    </span>
                  </div>
                </div>

                {/* Option 3c: Extreme Testing Scenario */}
                <div
                  onClick={handleLoadTheRefinementBlueprint}
                  className="p-8 border border-red-950/60 hover:border-red-600/80 transition-all duration-500 bg-zinc-950/60 hover:bg-red-950/20 rounded flex flex-col items-center justify-center cursor-pointer group"
                >
                  <AlertTriangle className="w-10 h-10 text-red-500/70 group-hover:text-red-400 transition-colors mb-3" />
                  <div className="text-center space-y-1">
                    <span className="text-xs uppercase tracking-[0.25em] block font-bold text-white">
                      The Refinement
                    </span>
                    <span className="text-xs text-red-400/80 uppercase tracking-wider block text-[10px]">
                      Extreme Testing Blueprint
                    </span>
                  </div>
                </div>

                {/* Option 4: Haunted House Mode */}
                <div className="md:col-span-3 p-8 border border-red-950/80 bg-zinc-950/60 rounded flex flex-col items-center justify-center gap-5 shadow-[inset_0_0_25px_rgba(239,68,68,0.05)]">
                  <div className="text-center">
                    <Skull className="w-10 h-10 text-red-500 mx-auto mb-3" />
                    <span className="text-sm uppercase tracking-[0.25em] block mb-1 text-zinc-100 font-bold">
                      Haunted House Induction Terminal
                    </span>
                    <span className="text-xs text-zinc-400 uppercase tracking-wider">
                      Phase 3C Procedural Opposition, Authority Contracts & Blueprint Convergence
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-zinc-300 max-w-xl text-center leading-relaxed font-sans">
                    Induct a fresh simulation directly by configuring your participation mode (Antagonist Avatar/Force, Protagonist, or Director) with bounded Authority, non-negotiable Limits, and authored Victims.
                  </p>

                  <button
                    onClick={() => setIsAdLibModalOpen(true)}
                    className="border-2 border-red-600 bg-red-950/40 hover:bg-red-600 hover:text-white text-red-300 px-8 py-3 text-xs tracking-[0.2em] uppercase font-bold transition-all duration-300 flex items-center gap-2 rounded cursor-pointer shadow-lg shadow-red-950/40 hover:shadow-red-600/30"
                  >
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Launch Haunted House Induction Terminal</span>
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-3 text-red-400 bg-red-950/30 border border-red-800 p-4 w-full rounded">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span className="text-xs uppercase tracking-wider">{error}</span>
                </div>
              )}

              <div className="pt-6 text-center">
                <p className="text-xs text-zinc-600 uppercase tracking-[0.3em]">
                  System Ready // Standby
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full space-y-8"
            >
              <div className="space-y-4">
                {/* Header with Provenance Badge */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-zinc-800 pb-4 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs text-zinc-500 uppercase tracking-widest">
                        Blueprint Loaded
                      </span>
                      {previewBlueprint.hauntedHouse && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-red-800 bg-red-950/60 text-red-300">
                          Haunted House Blueprint (v1)
                        </span>
                      )}
                      {previewBlueprint.hauntedHouse?.recommendedParticipationMode && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-zinc-700 bg-zinc-800 text-zinc-300">
                          Recommended: {previewBlueprint.hauntedHouse.recommendedParticipationMode}
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight uppercase text-white">
                      {previewBlueprint.title}
                    </h2>
                  </div>
                  <div className="sm:text-right">
                    <span className="text-xs text-zinc-500 uppercase tracking-widest block mb-1">
                      Scale {previewBlueprint.contentScale}
                    </span>
                    <span className="text-xs text-zinc-400 uppercase tracking-widest">
                      {previewBlueprint.contentLevelDescription}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-6">
                    {/* Cast Dossier */}
                    <div>
                      <h3 className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-[0.2em] mb-4 font-bold">
                        <Users className="w-4 h-4 text-zinc-300" />
                        Cast Members & Bound Operatives
                      </h3>
                      <div className="grid grid-cols-1 gap-3">
                        {previewBlueprint.cast?.map((char, i) => {
                          const isEligible = selectedRole
                            ? isCharacterEligibleForRole(char, selectedRole)
                            : false;
                          const isSelected = activeCharacterId === char.id;
                          return (
                            <button
                              key={char.id || i}
                              type="button"
                              data-character-id={char.id}
                              onClick={() => {
                                if (isSelected) {
                                  forgeActions.setActiveCharacterId(null);
                                  return;
                                }
                                // Auto-switch role if character not eligible under current role selection
                                if (!selectedRole || !isCharacterEligibleForRole(char, selectedRole)) {
                                  if (
                                    char.disposition === 'VILLAIN' &&
                                    (isRoleAvailable('villain') || isRoleAvailable('antagonist'))
                                  ) {
                                    handleSelectRole(isRoleAvailable('villain') ? 'villain' : 'antagonist');
                                  } else if (
                                    char.disposition === 'BYSTANDER' &&
                                    isRoleAvailable('bystander')
                                  ) {
                                    handleSelectRole('bystander');
                                  } else if (
                                    isRoleAvailable('survivor') ||
                                    isRoleAvailable('protagonist')
                                  ) {
                                    handleSelectRole(isRoleAvailable('survivor') ? 'survivor' : 'protagonist');
                                  }
                                }
                                forgeActions.setActiveCharacterId(char.id);
                              }}
                              className={`p-4 border text-left w-full transition-all duration-200 rounded flex flex-col gap-2 ${
                                isSelected
                                  ? 'border-red-500 bg-red-950/20 shadow-[0_0_15px_rgba(239,68,68,0.1)] cursor-pointer'
                                  : isEligible
                                  ? 'border-zinc-800 hover:border-zinc-600 bg-black opacity-90 hover:opacity-100 cursor-pointer'
                                  : 'border-zinc-900/80 bg-zinc-950/30 hover:border-zinc-700 opacity-60 hover:opacity-90 cursor-pointer'
                              }`}
                            >
                              <div className="flex justify-between items-center w-full">
                                <div className="flex items-center gap-2">
                                  <h4
                                    className={`font-bold text-sm ${
                                      isSelected ? 'text-red-400' : 'text-zinc-100'
                                    }`}
                                  >
                                    {char.name}
                                  </h4>
                                </div>
                                <div className="flex gap-2 items-center flex-wrap">
                                  {char.disposition === 'VILLAIN' ? (
                                    <span className="text-[10px] text-red-400 border border-red-900/80 px-1.5 py-0.5 rounded font-mono uppercase bg-red-950/40 flex items-center gap-1">
                                      <Skull className="w-2.5 h-2.5 text-red-500" /> VILLAIN
                                    </span>
                                  ) : char.disposition === 'BYSTANDER' ? (
                                    <span className="text-[10px] text-amber-400 border border-amber-900/80 px-1.5 py-0.5 rounded font-mono uppercase bg-amber-950/40 flex items-center gap-1">
                                      <Coffee className="w-2.5 h-2.5 text-amber-500" /> BYSTANDER
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-emerald-400 border border-emerald-900/80 px-1.5 py-0.5 rounded font-mono uppercase bg-emerald-950/40 flex items-center gap-1">
                                      <Shield className="w-2.5 h-2.5 text-emerald-500" /> SURVIVOR
                                    </span>
                                  )}
                                  {char.isEntity && (
                                    <span className="text-[10px] text-red-400 border border-red-900 px-1.5 py-0.5 rounded font-mono uppercase bg-red-950/30">
                                      ENTITY
                                    </span>
                                  )}
                                  <span className="text-[10px] uppercase font-mono text-cyan-400 px-1.5 py-0.5 border border-cyan-900 rounded bg-cyan-950/30">
                                    {char.behaviorVector || 'ADAPTIVE'}
                                  </span>
                                </div>
                              </div>
                              {char.description && (
                                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                                  {char.description}
                                </p>
                              )}
                              {(() => {
                                const charPursuit = previewBlueprint.horrorGrammar?.characterPursuits?.find(
                                  (p) => p.castMemberId === char.id
                                );
                                const reviewStatus = previewBlueprint.horrorGrammar?.pursuitReviews?.[char.id];
                                if (charPursuit && charPursuit.objective) {
                                  return (
                                    <div className="text-[11px] text-cyan-300 font-mono bg-cyan-950/20 border border-cyan-900/40 px-2 py-1 rounded">
                                      <span className="text-zinc-500 font-bold uppercase mr-1.5">Opening Objective:</span>
                                      {charPursuit.objective}
                                    </div>
                                  );
                                }
                                if (reviewStatus === 'REVIEWED_NONE') {
                                  return (
                                    <div className="text-[10px] text-zinc-500 font-mono italic">
                                      No Readable Intent
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </button>
                          );
                        })}
                      </div>
                      {(!previewBlueprint.cast || previewBlueprint.cast.length === 0) && (
                        <div className="text-xs text-zinc-500 italic p-3 bg-zinc-950 border border-zinc-800 rounded">
                          No cast identified in blueprint. Director narrative authority active.
                        </div>
                      )}
                    </div>

                    {/* Environmental Intel */}
                    <div>
                      <h3 className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-[0.2em] mb-4 font-bold">
                        <Activity className="w-4 h-4 text-zinc-300" />
                        Environmental Intel
                      </h3>
                      <div className="p-4 bg-zinc-950 border border-zinc-800 space-y-2 rounded">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500 uppercase">Location:</span>
                          <span className="text-zinc-300 uppercase font-semibold">
                            {previewBlueprint.setting.location}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500 uppercase">Period:</span>
                          <span className="text-zinc-300 uppercase font-semibold">
                            {previewBlueprint.setting.timePeriod}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-2 border-t border-zinc-800 pt-2 leading-relaxed">
                          {previewBlueprint.setting.atmosphere}
                        </p>
                      </div>
                    </div>

                    {/* Authority Contract Banner (if Haunted House provenance has authority contract) */}
                    {previewBlueprint.hauntedHouse?.participationContext?.authorityContract && (
                      <div className="p-4 bg-red-950/20 border border-red-900/60 rounded space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          Authored Authority & Limits Contract
                        </h4>
                        <div className="space-y-1.5 text-xs text-zinc-300">
                          <div>
                            <span className="text-zinc-500 uppercase font-bold">Authority: </span>
                            <span>{previewBlueprint.hauntedHouse.participationContext.authorityContract.authority}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500 uppercase font-bold">Limits: </span>
                            <span>{previewBlueprint.hauntedHouse.participationContext.authorityContract.limits}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-8">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-[0.2em] font-bold">
                          <Activity className="w-4 h-4 text-zinc-300" />
                          Neural Link Orientation
                        </h3>
                        {previewBlueprint.hauntedHouse && (
                          <span className="text-[10px] text-zinc-400 uppercase font-mono">
                            4-Seat Matrix
                          </span>
                        )}
                      </div>

                      {/* Compatibility Warning for Incompatible Recommended Seat */}
                      {isRecommendedSeatUnavailable && (
                        <div className="p-3.5 bg-amber-950/30 border border-amber-800/80 rounded mb-4 space-y-1.5">
                          <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Recommended Seat Unavailable
                          </div>
                          <p className="text-[11px] text-zinc-300 leading-relaxed">
                            This blueprint recommends{' '}
                            <span className="text-amber-300 font-semibold uppercase">
                              {previewBlueprint.hauntedHouse?.recommendedParticipationMode}
                            </span>
                            , but that seat is unavailable (
                            {previewBlueprint.hauntedHouse?.recommendedParticipationMode &&
                              seatAvailabilities?.[previewBlueprint.hauntedHouse.recommendedParticipationMode]?.reason}
                            ). Please explicitly select an available seat below before initializing the simulation.
                          </p>
                        </div>
                      )}

                      {/* 4-Role Seat Selection Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Survivor */}
                        {(() => {
                          const survivorAvailable = isRoleAvailable('survivor') || isRoleAvailable('protagonist');
                          const isSurvivorSelected = selectedRole === 'survivor' || selectedRole === 'protagonist';
                          const survivorSeat = seatAvailabilities?.survivor || seatAvailabilities?.protagonist;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (!survivorAvailable) return;
                                handleSelectRole(isRoleAvailable('survivor') ? 'survivor' : 'protagonist');
                              }}
                              disabled={!survivorAvailable}
                              className={`p-4 border flex flex-col items-center text-center gap-2 transition-all duration-300 rounded ${
                                !survivorAvailable
                                  ? 'border-zinc-900 bg-zinc-950/40 text-zinc-600 opacity-40 cursor-not-allowed'
                                  : isSurvivorSelected
                                  ? 'border-emerald-500 bg-emerald-950/30 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] cursor-pointer'
                                  : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600 cursor-pointer'
                              }`}
                            >
                              <Shield className="w-5 h-5 text-emerald-400" />
                              <div>
                                <span className="text-xs uppercase font-bold tracking-wider block">
                                  Survivor
                                </span>
                                <span className="text-[9px] text-zinc-500 uppercase tracking-widest block font-mono">
                                  Protagonist
                                </span>
                                <span className="text-[10px] text-zinc-500 block mt-0.5 truncate max-w-[120px]">
                                  {survivorAvailable
                                    ? survivorSeat?.boundCharacterName || 'Mortal Operative'
                                    : survivorSeat?.reason || 'No Mortal Cast'}
                                </span>
                              </div>
                            </button>
                          );
                        })()}

                        {/* Villain */}
                        {(() => {
                          const villainAvailable = isRoleAvailable('villain') || isRoleAvailable('antagonist');
                          const isVillainSelected = selectedRole === 'villain' || selectedRole === 'antagonist';
                          const villainSeat = seatAvailabilities?.villain || seatAvailabilities?.antagonist;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (!villainAvailable) return;
                                handleSelectRole(isRoleAvailable('villain') ? 'villain' : 'antagonist');
                              }}
                              disabled={!villainAvailable}
                              className={`p-4 border flex flex-col items-center text-center gap-2 transition-all duration-300 rounded ${
                                !villainAvailable
                                  ? 'border-zinc-900 bg-zinc-950/40 text-zinc-600 opacity-40 cursor-not-allowed'
                                  : isVillainSelected
                                  ? 'border-red-600 bg-red-950/30 text-white shadow-[0_0_15px_rgba(220,38,38,0.25)] cursor-pointer'
                                  : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600 cursor-pointer'
                              }`}
                            >
                              <Skull className="w-5 h-5 text-red-500" />
                              <div>
                                <span className="text-xs uppercase font-bold tracking-wider block">
                                  Villain
                                </span>
                                <span className="text-[9px] text-zinc-500 uppercase tracking-widest block font-mono">
                                  Antagonist
                                </span>
                                <span className="text-[10px] text-zinc-500 block mt-0.5 truncate max-w-[120px]">
                                  {villainAvailable
                                    ? (activeCharacterId ? villainSeat?.boundCharacterName || 'Predator / Entity' : 'Select a villain below')
                                    : villainSeat?.reason || 'No Hostile Cast'}
                                </span>
                              </div>
                            </button>
                          );
                        })()}

                        {/* Bystander */}
                        {(() => {
                          const bystanderAvailable = isRoleAvailable('bystander');
                          const isBystanderSelected = selectedRole === 'bystander';
                          const bystanderSeat = seatAvailabilities?.bystander;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (!bystanderAvailable) return;
                                handleSelectRole('bystander');
                              }}
                              disabled={!bystanderAvailable}
                              className={`p-4 border flex flex-col items-center text-center gap-2 transition-all duration-300 rounded ${
                                !bystanderAvailable
                                  ? 'border-zinc-900 bg-zinc-950/40 text-zinc-600 opacity-40 cursor-not-allowed'
                                  : isBystanderSelected
                                  ? 'border-amber-500 bg-amber-950/30 text-white shadow-[0_0_15px_rgba(245,158,11,0.25)] cursor-pointer'
                                  : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600 cursor-pointer'
                              }`}
                            >
                              <Coffee className="w-5 h-5 text-amber-400" />
                              <div>
                                <span className="text-xs uppercase font-bold tracking-wider block">
                                  Bystander
                                </span>
                                <span className="text-[10px] text-zinc-500 block mt-0.5 truncate max-w-[120px]">
                                  {bystanderAvailable
                                    ? bystanderSeat?.boundCharacterName || 'Civilian Collateral'
                                    : bystanderSeat?.reason || 'No Bystander Cast'}
                                </span>
                              </div>
                            </button>
                          );
                        })()}

                        {/* Director */}
                        {(() => {
                          const directorAvailable = isRoleAvailable('director');
                          const isDirectorSelected = selectedRole === 'director';
                          const directorSeat = seatAvailabilities?.director;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (!directorAvailable) return;
                                handleSelectRole('director');
                              }}
                              disabled={!directorAvailable}
                              className={`p-4 border flex flex-col items-center text-center gap-2 transition-all duration-300 rounded ${
                                !directorAvailable
                                  ? 'border-zinc-900 bg-zinc-950/40 text-zinc-600 opacity-40 cursor-not-allowed'
                                  : isDirectorSelected
                                  ? 'border-purple-500 bg-purple-950/30 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)] cursor-pointer'
                                  : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600 cursor-pointer'
                              }`}
                            >
                              <Film className="w-5 h-5 text-purple-400" />
                              <div>
                                <span className="text-xs uppercase font-bold tracking-wider block">
                                  Director
                                </span>
                                {!directorAvailable && (
                                  <span className="text-[9px] uppercase tracking-widest font-mono text-purple-400/70 border border-purple-900/60 px-1.5 py-0.5 rounded">
                                    Not yet built
                                  </span>
                                )}
                                <span className="text-[10px] text-zinc-500 block mt-0.5">
                                  {directorAvailable ? 'Narrative Framing' : directorSeat?.reason || 'Not yet built'}
                                </span>
                              </div>
                            </button>
                          );
                        })()}
                      </div>

                      {/* Selected seat summary description */}
                      <p className="text-xs text-zinc-400 mt-4 leading-relaxed uppercase tracking-wider text-center font-sans">
                        {(selectedRole === 'survivor' || selectedRole === 'protagonist') &&
                          'Embodying mortal operative subject to local physical constraints and escalating dread.'}
                        {(selectedRole === 'villain' || selectedRole === 'antagonist') &&
                          'Operating predatory villain or hostile opposition agency under explicit authority terms.'}
                        {selectedRole === 'bystander' &&
                          'Operating civilian bystander with mundane priorities, survival instincts, and detached perspective.'}
                        {selectedRole === 'director' &&
                          'External pacing, framing, and dramaturgical oversight authority.'}
                        {!selectedRole &&
                          'Select an available seat above to configure your active neural link.'}
                      </p>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={handleStart}
                        disabled={!selectedRole || !isRoleAvailable(selectedRole)}
                        className={`w-full py-5 text-xs font-bold uppercase tracking-[0.4em] transition-all flex items-center justify-center gap-3 group rounded ${
                          !selectedRole || !isRoleAvailable(selectedRole)
                            ? 'bg-zinc-800/60 text-zinc-500 cursor-not-allowed border border-zinc-700/40'
                            : 'bg-white text-black hover:bg-zinc-200 shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-[0.98] cursor-pointer'
                        }`}
                      >
                        <Play className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
                        {selectedRole
                          ? `Initialize Neural Link (${selectedRole.toUpperCase()})`
                          : 'Select Available Seat to Initialize'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AdLibInductionModal
        isOpen={isAdLibModalOpen}
        onClose={() => setIsAdLibModalOpen(false)}
        onSuccess={onContinue}
      />
    </div>
  );
}
