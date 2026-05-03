import { RelicDeltaModifiers, KeyMatchups } from '../utils/relicDeltaService';
import { ScrapedCron } from './swgohGgTypes';

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
  /**
   * Datacron the opponent used on this defense squad, scraped verbatim from
   * swgoh.gg's GAC battle summary. Forwarded through the strategy pipeline so
   * the offense image can render the opponent's actual cron alongside the
   * counter recommendation.
   */
  datacron?: ScrapedCron;
}

export interface MissingAbilityInfo {
  abilityId: string;
  unitBaseId: string;
  reason: string;
  shortDescription?: string;
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
  /**
   * Set when this counter looks datacron-dependent (high win rate, low sample
   * count) and the user's focused datacrons don't appear to leverage its leader.
   * Surface as a soft warning in the offense image — don't filter out, since
   * the heuristic can miss.
   */
  datacronWarning?: string;
}

export interface DefenseSuggestion {
  squad: UniqueDefensiveSquad;
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
  score: number;
  reason: string;
  /** Archetype validation result for this defense squad */
  archetypeValidation?: ArchetypeValidationInfo;
}
