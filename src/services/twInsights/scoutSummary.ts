import { ComlinkGuildData, ComlinkRecentTw } from '../../integrations/comlink/comlinkClient';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { buildGuildSnapshot } from '../guildInsights';
import { ScoutSnapshot } from './types';

const MAX_PATTERN = 10;

function decodeOutcome(t: ComlinkRecentTw): 'win' | 'loss' | 'unknown' {
  // Real Comlink payload has no 'outcome' field — derive from score comparison.
  const ours = parseInt(t.score, 10);
  const theirs = parseInt(t.opponentScore, 10);
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return 'unknown';
  if (ours > theirs) return 'win';
  if (ours < theirs) return 'loss';
  return 'unknown';
}

function extractPattern(guild: ComlinkGuildData): { available: boolean; pattern: Array<'win' | 'loss' | 'unknown'> } {
  const raw = guild.guild.recentTerritoryWarResult;
  if (raw === undefined) return { available: false, pattern: [] };
  return { available: true, pattern: raw.slice(0, MAX_PATTERN).map(decodeOutcome) };
}

export function buildScoutSnapshot(
  guild: ComlinkGuildData,
  roster: Map<string, SwgohGgFullPlayerResponse>
): ScoutSnapshot {
  const { available, pattern } = extractPattern(guild);
  return {
    guild: buildGuildSnapshot(guild, roster),
    recentTwPattern: pattern,
    twAvailable: available,
  };
}
