import { GacCounterSquad } from '../../../types/swgohGgTypes';
import { UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../types/swgohGgTypes';
import { scoreCounterAgainstDefence, CounterScoringContext } from './scoringHelpers';
import { isGalacticLegend } from '../../../config/gacConstants';
import { createRosterAdapter } from '../../archetypeValidation/archetypeValidator';

const TOP_N = 5;

/**
 * Top-N counters for a single defensive squad, filtered by:
 *  - the user must own every character on the counter
 *  - no character on the counter may appear in `usedCharacters`
 *
 * Pure function — no I/O, no logger.
 */
export function selectTopCountersAvailable(
  counters: GacCounterSquad[],
  defensiveSquad: UniqueDefensiveSquad,
  userRoster: SwgohGgFullPlayerResponse,
  usedCharacters: Set<string>,
  format: string = '5v5',
  strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
): GacCounterSquad[] {
  const userUnitMap = buildUserUnitMap(userRoster);
  const expectedCounterSize = format === '3v3' ? 3 : 5;
  const isDefensiveSquadGL = isGalacticLegend(defensiveSquad.leader.baseId);
  const rosterAdapter = createRosterAdapter(userRoster);

  // Pre-filter: ownership + used characters + size
  const candidates: GacCounterSquad[] = [];
  for (const c of counters) {
    const all = [c.leader.baseId, ...c.members.map(m => m.baseId)];
    if (all.length > expectedCounterSize) continue;
    if (all.some(id => usedCharacters.has(id))) continue;
    if (all.some(id => !userUnitMap.has(id))) continue;
    candidates.push(c);
  }

  if (candidates.length === 0) return [];

  const maxSeenCount = Math.max(
    ...candidates.map(c => c.seenCount ?? 0),
    1,
  );

  const ctx: CounterScoringContext = {
    userUnitMap,
    format,
    strategyPreference,
    allAvailableCounters: candidates,
    maxSeenCount,
    rosterAdapter,
    isDefensiveSquadGL,
    expectedCounterSize,
    userDatacronLeveragedChars: undefined,
    metaDatacronActivatedChars: undefined,
  };

  const scored: Array<{ counter: GacCounterSquad; score: number }> = [];
  for (const c of candidates) {
    const { score } = scoreCounterAgainstDefence(c, defensiveSquad, ctx);
    if (Number.isFinite(score)) scored.push({ counter: c, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_N).map(s => s.counter);
}

function buildUserUnitMap(roster: SwgohGgFullPlayerResponse): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const u of roster.units ?? []) {
    if (u.data.rarity < 7) continue;
    let relic: number | null = null;
    if (u.data.gear_level >= 13 && u.data.relic_tier != null) {
      relic = Math.max(0, u.data.relic_tier - 2);
    }
    map.set(u.data.base_id, relic);
  }
  return map;
}
