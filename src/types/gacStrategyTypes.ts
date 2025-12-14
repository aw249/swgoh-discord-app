import { RelicDeltaModifiers, KeyMatchups } from '../utils/relicDeltaService';

export interface UniqueDefensiveSquadUnit {
  baseId: string;
  /** Gear level (1-13), optional for backwards compatibility */
  gearLevel?: number | null;
  /** Display relic level (0-10), null if not G13 */
  relicLevel: number | null;
  portraitUrl: string | null;
}

export interface UniqueDefensiveSquad {
  leader: UniqueDefensiveSquadUnit;
  members: UniqueDefensiveSquadUnit[];
}

export interface MatchedCounterSquad {
  offense: UniqueDefensiveSquad;
  defense: UniqueDefensiveSquad;
  winPercentage: number | null;
  adjustedWinPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  relicDelta: RelicDeltaModifiers | null;
  worstCaseRelicDelta: RelicDeltaModifiers | null;
  bestCaseRelicDelta: RelicDeltaModifiers | null;
  keyMatchups: KeyMatchups | null;
  alternatives?: MatchedCounterSquad[];
}

export interface DefenseSuggestion {
  squad: UniqueDefensiveSquad;
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  score: number;
  reason: string;
}
