import React from 'react';
import {
  Skull,
  Shield,
  Coffee,
  Film,
  HeartPulse,
  Backpack,
  Users,
  Activity,
  Clock,
  Gauge,
  Lock,
} from 'lucide-react';
import { ImpendingClock, MacroPhase, PacingCadence } from '../../types/dramaturgy';

export interface CastMemberTelemetry {
  id: string;
  name: string;
  role?: string;
  location?: string;
  psychological_status?: string;
  skepticism?: number;
  isCurrentPlayer?: boolean;
  isObstructed?: boolean;
  obstructionReason?: string;
  currentComposure?: number;
}

export interface MortalLedgerProps {
  playerCharacterName?: string;
  playerRoleCategory?: string;
  psychologicalStatus?: string;
  injuries?: string[];
  inventory?: string[];
  castMembers?: CastMemberTelemetry[];
  className?: string;
  impendingClocks?: ImpendingClock[];
  currentLocationNodeId?: string;
  macroPhase?: MacroPhase;
  pacingCadence?: PacingCadence;
}

function getClockManifestationText(clock: ImpendingClock): string {
  if (!clock.manifestationCues || clock.manifestationCues.length === 0) {
    return 'The pressure of impending systemic breakdown remains latent.';
  }
  const level = clock.currentLevel ?? 0;
  const sorted = [...clock.manifestationCues].sort((a, b) => a.atLevel - b.atLevel);
  let activeCue = sorted[0]?.cue || 'The immediate environment is temporarily quiet.';
  for (const c of sorted) {
    if (level >= c.atLevel) {
      activeCue = c.cue;
    }
  }
  return activeCue;
}

export default function MortalLedger({
  playerCharacterName = 'Unknown Vessel',
  playerRoleCategory = 'SURVIVOR',
  psychologicalStatus = 'Stable',
  injuries = [],
  inventory = [],
  castMembers = [],
  className = '',
  impendingClocks = [],
  currentLocationNodeId,
  macroPhase,
  pacingCadence,
}: MortalLedgerProps) {
  const normRole = (playerRoleCategory || 'SURVIVOR').toUpperCase();

  const getRoleIcon = () => {
    switch (normRole) {
      case 'VILLAIN':
        return <Skull className="w-4 h-4 text-red-400 animate-pulse" />;
      case 'BYSTANDER':
        return <Coffee className="w-4 h-4 text-amber-400" />;
      case 'DIRECTOR':
        return <Film className="w-4 h-4 text-purple-400" />;
      default:
        return <Shield className="w-4 h-4 text-emerald-400" />;
    }
  };

  const getRoleBadgeClasses = () => {
    switch (normRole) {
      case 'VILLAIN':
        return 'bg-red-950/60 border-red-800/80 text-red-300';
      case 'BYSTANDER':
        return 'bg-amber-950/60 border-amber-800/80 text-amber-300';
      case 'DIRECTOR':
        return 'bg-purple-950/60 border-purple-800/80 text-purple-300';
      default:
        return 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300';
    }
  };

  return (
    <div
      data-testid="mortal-ledger"
      className={`rounded-lg border border-zinc-800/80 bg-zinc-950/90 text-zinc-300 font-mono shadow-2xl backdrop-blur flex flex-col select-none overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between bg-black/40">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-[#d97706] shadow-[0_0_6px_#d97706]" />
          <h3 className="font-serif tracking-widest text-zinc-200 uppercase text-xs font-semibold">
            Mortal Ledger // Tracked Vessels
          </h3>
        </div>
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
          Somatic Matrix
        </span>
      </div>

      {/* Phase & Cadence Bar (HG2 Transparency) */}
      {macroPhase && (
        <div data-testid="mortal-ledger-pacing-bar" className="px-4 py-1.5 bg-zinc-900/60 border-b border-zinc-800/60 flex items-center justify-between text-[10px] tracking-wider uppercase text-zinc-400">
          <span>Phase: <strong className="text-zinc-200">{macroPhase.replace(/_/g, ' ')}</strong></span>
          {pacingCadence && <span>Cadence: <strong className="text-amber-300">{pacingCadence.replace(/_/g, ' ')}</strong></span>}
        </div>
      )}

      <div className="p-4 space-y-5 overflow-y-auto custom-scrollbar">
        {/* Active Player Vessel Section */}
        <div
          data-testid="player-vessel-card"
          className="p-3.5 rounded border border-zinc-800 bg-zinc-900/40 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span
                data-testid="player-character-name"
                className="font-serif font-bold text-sm tracking-wide text-zinc-100 truncate"
              >
                {playerCharacterName}
              </span>
            </div>
            <span
              data-testid="player-role-badge"
              className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border font-mono font-bold flex items-center gap-1 shrink-0 ${getRoleBadgeClasses()}`}
            >
              {getRoleIcon()}
              {normRole}
            </span>
          </div>

          {/* Psychological State */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-800/60">
            <span className="text-zinc-500 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Activity className="w-3.5 h-3.5 text-zinc-400" />
              Mind
            </span>
            <span
              data-testid="psychological-status"
              className="text-amber-300 font-medium text-xs truncate max-w-[200px]"
            >
              {psychologicalStatus}
            </span>
          </div>

          {/* Somatic Injuries */}
          <div className="space-y-1.5 pt-1 border-t border-zinc-800/60 text-xs">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
              <HeartPulse className="w-3.5 h-3.5 text-zinc-400" />
              <span>Somatic Integrity</span>
            </div>
            <div data-testid="injuries-container">
              {injuries && injuries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {injuries.map((injury, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded border border-red-900/80 bg-red-950/40 text-red-300 text-[10px] tracking-wide"
                    >
                      {injury}
                    </span>
                  ))}
                </div>
              ) : (
                <div
                  data-testid="empty-injuries"
                  className="text-[11px] text-zinc-500 italic"
                >
                  Unharmed; flesh intact
                </div>
              )}
            </div>
          </div>

          {/* Carried Inventory */}
          <div className="space-y-1.5 pt-1 border-t border-zinc-800/60 text-xs">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
              <Backpack className="w-3.5 h-3.5 text-zinc-400" />
              <span>Relics &amp; Possessions</span>
            </div>
            <div data-testid="inventory-container">
              {inventory && inventory.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {inventory.map((item, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded border border-zinc-700/80 bg-zinc-800/40 text-zinc-200 text-[10px] tracking-wide"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <div
                  data-testid="empty-inventory"
                  className="text-[11px] text-zinc-500 italic"
                >
                  No physical relics carried
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Impending Clocks & Environmental Omens (HG2 D2 Diegetic) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800/60 pb-1.5">
            <span className="flex items-center gap-1.5 font-serif italic text-zinc-300 font-semibold">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              Impending Clocks &amp; Omens
            </span>
            <span className="text-[10px] text-zinc-500">
              {impendingClocks ? impendingClocks.length : 0} Clocks
            </span>
          </div>

          <div data-testid="impending-clocks-list" className="space-y-2">
            {impendingClocks && impendingClocks.length > 0 ? (
              impendingClocks.map((clock, idx) => {
                const isSituatedHere = Boolean(
                  clock.diegeticInstrument &&
                  clock.instrumentNodeId &&
                  currentLocationNodeId &&
                  clock.instrumentNodeId === currentLocationNodeId
                );
                const manifestationProse = getClockManifestationText(clock);
                return (
                  <div
                    key={clock.id || idx}
                    data-testid={`impending-clock-${clock.id}`}
                    className="p-2.5 rounded border border-zinc-800/80 bg-black/40 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-serif font-semibold text-zinc-200 tracking-wide truncate">
                        {clock.name}
                      </span>
                      {isSituatedHere && clock.diegeticInstrument ? (
                        <span
                          data-testid={`diegetic-gauge-${clock.id}`}
                          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/80 text-amber-300 flex items-center gap-1 shrink-0"
                        >
                          <Gauge className="w-3 h-3 text-amber-400" />
                          {clock.diegeticInstrument}: {clock.currentLevel}/{clock.crisisThreshold}
                        </span>
                      ) : clock.diegeticInstrument ? (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 shrink-0">
                          Instrument situated elsewhere
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[11px] text-zinc-400 leading-relaxed italic">
                      &ldquo;{manifestationProse}&rdquo;
                    </p>

                    {clock.currentLevel >= clock.crisisThreshold && (
                      <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">
                        CRISIS THRESHOLD BREACHED
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div
                data-testid="empty-clocks"
                className="p-3 rounded border border-dashed border-zinc-800/80 text-center text-xs text-zinc-500 italic bg-black/20"
              >
                No active environmental clocks pressing on reality.
              </div>
            )}
          </div>
        </div>

        {/* Tracked Cohort Offerings (Pure Text - Zero Portrait Avatars) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800/60 pb-1.5">
            <span className="flex items-center gap-1.5 font-serif italic text-zinc-300 font-semibold">
              <Users className="w-3.5 h-3.5 text-zinc-400" />
              Tracked Cohort
            </span>
            <span className="text-[10px] text-zinc-500">
              {castMembers ? castMembers.length : 0} Vessels
            </span>
          </div>

          <div data-testid="cast-members-list" className="space-y-2">
            {castMembers && castMembers.length > 0 ? (
              castMembers.map((member, idx) => (
                <div
                  key={member.id || idx}
                  data-testid={`cast-member-${member.id}`}
                  className={`p-2.5 rounded border text-xs transition-colors space-y-1.5 ${
                    member.isCurrentPlayer
                      ? 'bg-amber-950/20 border-amber-800/70 text-amber-200'
                      : 'bg-black/40 border-zinc-800/80 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif font-semibold text-zinc-200 tracking-wide truncate">
                      {member.name}
                    </span>
                    {member.role && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 shrink-0">
                        {member.role}
                      </span>
                    )}
                  </div>

                  {/* Obstructive Breaking Point Badge (HG2 D3) */}
                  {member.isObstructed && (
                    <div
                      data-testid={`obstruction-badge-${member.id}`}
                      className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-950/60 border border-red-800 text-red-300 text-[10px] font-bold"
                    >
                      <Lock className="w-3 h-3 text-red-400 shrink-0" />
                      <span>OBSTRUCTED: {member.obstructionReason || 'Refuses to proceed past breaking point'}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5">
                    <span className="truncate">
                      <span className="text-zinc-500 mr-1">LOC:</span>
                      {member.location || 'Co-present'}
                    </span>
                    {member.psychological_status && (
                      <span className="text-zinc-400 italic truncate max-w-[140px]">
                        {member.psychological_status}
                      </span>
                    )}
                  </div>

                  {typeof member.currentComposure === 'number' && (
                    <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                      <span>COMPOSURE:</span>
                      <span className="text-zinc-400">{member.currentComposure}/100</span>
                    </div>
                  )}

                  {typeof member.skepticism === 'number' && (
                    <div className="flex items-center gap-2 pt-0.5 text-[9px] text-zinc-500 font-mono">
                      <span>SKEPTICISM:</span>
                      <div className="flex-1 h-1 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
                        <div
                          className="h-full bg-amber-600/70"
                          style={{
                            width: `${Math.min(100, Math.max(0, member.skepticism * 10))}%`,
                          }}
                        />
                      </div>
                      <span className="text-zinc-400">{member.skepticism}/10</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div
                data-testid="empty-cast"
                className="p-4 rounded border border-dashed border-zinc-800/80 text-center text-xs text-zinc-500 italic bg-black/20"
              >
                No companion vessels tracked in this realm.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
