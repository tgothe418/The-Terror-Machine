import type {
  VocalDelivery,
  VocalMedium,
  LocationTopology,
  LocationTopologyConnection,
} from '../types/vocalization';

export type { VocalMedium, LocationTopology, LocationTopologyConnection };

const BROADCAST_ACOUSTIC_MEDIUMS: ReadonlySet<string> = new Set([
  'intercom',
  'broadcast',
  'vent',
]);

const WHISPER_DELIVERIES_SET: ReadonlySet<string> = new Set([
  'whisper',
  'mutter',
]);

/**
 * Checks whether a topology connection is acoustically sealed.
 * Sealed connections strictly block acoustic bleed.
 */
export function isSealedTopologyConnection(
  conn: LocationTopologyConnection | null | undefined
): boolean {
  if (!conn || typeof conn !== 'object') return false;
  if (conn.sealed === true || conn.isSealed === true) return true;
  if (typeof conn.status === 'string' && conn.status.trim().toUpperCase() === 'SEALED') {
    return true;
  }
  return false;
}

/**
 * Determines whether a connection carries acoustic bleed.
 * True if explicitly marked acousticBleed: true (and unsealed),
 * or represents an open acoustic portal / unsealed connection with bleed.
 * False if acousticBleed: false or sealed.
 */
export function connectionCarriesAcousticBleed(
  conn: LocationTopologyConnection | null | undefined
): boolean {
  if (!conn || typeof conn !== 'object') return false;

  // Explicit acousticBleed: false always blocks bleed
  if (conn.acousticBleed === false) return false;

  // Sealed connections strictly block acoustic bleed
  if (isSealedTopologyConnection(conn)) return false;

  // Explicit acousticBleed: true carries bleed (when unsealed)
  if (conn.acousticBleed === true) return true;

  // Open acoustic portal flags
  if (conn.openAcousticPortal === true || conn.openPortal === true) return true;
  if (conn.acousticPortal === true || conn.portal === true) return true;
  if (
    typeof conn.acousticPortal === 'string' &&
    conn.acousticPortal.trim().toLowerCase() === 'open'
  ) {
    return true;
  }
  if (
    typeof conn.portal === 'string' &&
    conn.portal.trim().toLowerCase() === 'open'
  ) {
    return true;
  }

  // Unsealed connection with explicit bleed flag
  if (conn.bleed === true || conn.hasBleed === true) return true;

  // Portal or vent/duct kind with open status
  const kind = String(conn.kind ?? conn.type ?? '').trim().toLowerCase();
  if (
    kind === 'portal' ||
    kind === 'acoustic_portal' ||
    kind === 'vent' ||
    kind === 'duct' ||
    kind === 'acoustic_bleed'
  ) {
    const status = String(conn.status ?? '').trim().toLowerCase();
    const isOpen =
      conn.isOpen === true ||
      conn.open === true ||
      status === 'open' ||
      (!conn.status && conn.isOpen !== false && conn.open !== false);
    if (isOpen) return true;
  }

  return false;
}

/**
 * Extracts normalized connections from a LocationTopology structure.
 */
function extractTopologyConnections(
  topology: LocationTopology | LocationTopologyConnection[] | null | undefined
): LocationTopologyConnection[] {
  if (!topology) return [];
  if (Array.isArray(topology)) return topology;
  if (typeof topology === 'object') {
    if (Array.isArray(topology.connections)) return topology.connections;
    if (Array.isArray(topology.topologyConnections)) return topology.topologyConnections;
    if (Array.isArray(topology.edges)) return topology.edges;
  }
  return [];
}

/**
 * Extracts connected node endpoints from a connection record.
 */
function extractConnectionEndpoints(
  conn: LocationTopologyConnection
): { from: string | null; to: string | null; isDirected: boolean } {
  const from =
    conn.from ??
    conn.fromNodeId ??
    conn.source ??
    (Array.isArray(conn.nodes) && typeof conn.nodes[0] === 'string' ? conn.nodes[0] : null) ??
    conn.nodeA ??
    null;

  const to =
    conn.to ??
    conn.toNodeId ??
    conn.target ??
    (Array.isArray(conn.nodes) && typeof conn.nodes[1] === 'string' ? conn.nodes[1] : null) ??
    conn.nodeB ??
    null;

  const isDirected =
    conn.directed === true ||
    conn.bidirectional === false ||
    conn.oneWay === true;

  return {
    from: typeof from === 'string' ? from.trim() : null,
    to: typeof to === 'string' ? to.trim() : null,
    isDirected,
  };
}

/**
 * Pure function resolving the set of character IDs that acoustically hear a vocalization.
 *
 * Rules:
 * - internal: returns [] (internal monologue has no external acoustic hearers).
 * - direct with whisper/mutter: returns characters located in sourceNodeId only.
 * - direct with spoken (default): returns characters in sourceNodeId PLUS characters
 *   in adjacent connected nodes whose connection carries acoustic bleed.
 * - direct with shout, or broadcast mediums (intercom, broadcast, vent): returns characters
 *   in sourceNodeId PLUS characters in all directly adjacent connected nodes.
 * - Non-adjacent nodes (distance >= 2) are strictly excluded.
 * - Returns deterministically sorted (localeCompare), deduplicated character IDs.
 */
export function resolveAcousticAudience(
  medium: VocalMedium,
  topology: LocationTopology,
  sourceNodeId: string,
  characterNodes: Record<string, string> | Map<string, string>,
  delivery?: VocalDelivery | string
): string[] {
  const normalizedMedium = (
    typeof medium === 'string' ? medium.trim().toLowerCase() : 'direct'
  ) as VocalMedium;

  // 1. Internal monologue has no external acoustic hearers
  if (normalizedMedium === 'internal') {
    return [];
  }

  const trimmedSourceNode = typeof sourceNodeId === 'string' ? sourceNodeId.trim() : '';
  if (!trimmedSourceNode) {
    return [];
  }

  // Normalize character nodes mapping
  const charNodeList: Array<{ characterId: string; nodeId: string }> = [];
  if (characterNodes instanceof Map) {
    for (const [charId, nodeId] of characterNodes.entries()) {
      if (typeof charId === 'string' && typeof nodeId === 'string') {
        const trimmedChar = charId.trim();
        const trimmedNode = nodeId.trim();
        if (trimmedChar && trimmedNode) {
          charNodeList.push({ characterId: trimmedChar, nodeId: trimmedNode });
        }
      }
    }
  } else if (characterNodes && typeof characterNodes === 'object') {
    for (const [charId, nodeId] of Object.entries(characterNodes)) {
      if (typeof charId === 'string' && typeof nodeId === 'string') {
        const trimmedChar = charId.trim();
        const trimmedNode = nodeId.trim();
        if (trimmedChar && trimmedNode) {
          charNodeList.push({ characterId: trimmedChar, nodeId: trimmedNode });
        }
      }
    }
  }

  if (charNodeList.length === 0) {
    return [];
  }

  const normalizedDelivery = (
    typeof delivery === 'string' && delivery.trim()
      ? delivery.trim().toLowerCase()
      : 'spoken'
  ) as VocalDelivery;

  const isBroadcastMedium = BROADCAST_ACOUSTIC_MEDIUMS.has(normalizedMedium);
  const isShout = normalizedDelivery === 'shout';
  const isWhisperOrMutter = WHISPER_DELIVERIES_SET.has(normalizedDelivery);

  const audibleNodeIds = new Set<string>([trimmedSourceNode]);

  if (!isWhisperOrMutter || isBroadcastMedium) {
    const connections = extractTopologyConnections(topology);

    for (const conn of connections) {
      const { from, to, isDirected } = extractConnectionEndpoints(conn);
      if (!from || !to) continue;

      let adjacentNode: string | null = null;
      if (from === trimmedSourceNode && to !== trimmedSourceNode) {
        adjacentNode = to;
      } else if (!isDirected && to === trimmedSourceNode && from !== trimmedSourceNode) {
        adjacentNode = from;
      }

      if (!adjacentNode) continue;

      if (isBroadcastMedium || isShout) {
        // Direct shout or broadcast mediums propagate to ALL directly adjacent connected nodes
        audibleNodeIds.add(adjacentNode);
      } else {
        // Spoken / default delivery propagates to adjacent nodes whose connection carries acoustic bleed
        if (connectionCarriesAcousticBleed(conn)) {
          audibleNodeIds.add(adjacentNode);
        }
      }
    }
  }

  // Filter character nodes and deduplicate
  const audience = new Set<string>();
  for (const { characterId, nodeId } of charNodeList) {
    if (audibleNodeIds.has(nodeId)) {
      audience.add(characterId);
    }
  }

  return Array.from(audience).sort((a, b) => a.localeCompare(b));
}
