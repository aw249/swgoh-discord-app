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

export interface MissingAbilityInfo {
  abilityId: string;
  unitBaseId: string;
  reason: string;
}

export interface ArchetypeValidationInfo {
  /** Whether the counter is viable based on archetype requirements */
  viable: boolean;
  /** Confidence score (0-1) based on optional abilities */
  confidence: number;
  /** Missing required abilities (zetas/omicrons) */
  missingRequired?: MissingAbilityInfo[];
  /** Missing optional abilities that would improve the counter */
  missingOptional?: MissingAbilityInfo[];
  /** Warnings about the counter setup */
  warnings?: string[];
  /** The archetype ID used for validation (if any) */
  archetypeId?: string;
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
  /** Archetype validation results - indicates if zetas/omicrons are correct */
  archetypeValidation?: ArchetypeValidationInfo;
}

export interface DefenseSuggestion {
  squad: UniqueDefensiveSquad;
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  score: number;
  reason: string;
}
