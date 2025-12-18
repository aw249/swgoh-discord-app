/**
 * Types for the config-driven archetype validation engine.
 * 
 * DESIGN PHILOSOPHY:
 * - Archetypes describe WHY a squad works (mechanics), not WHAT it beats
 * - Validation uses Comlink ability IDs, never string matching on names
 * - Mode gates handle GAC 3v3 vs 5v5 vs TW omicron differences
 * - Inheritance allows 3v3 variants to extend 5v5 base archetypes
 * 
 * SCALING STRATEGY:
 * - We need ~100-200 archetypes to cover the game, NOT thousands
 * - One archetype per "squad engine" (e.g., IT_VEERS_TRAIN covers ALL IT counters)
 * - Archetypes are grouped by leader since leader usually defines the engine
 */

/** Game modes where omicrons/mechanics may differ */
export type GameMode = 
  | 'GAC_3v3' 
  | 'GAC_5v5' 
  | 'TW' 
  | 'CONQUEST'
  | 'TB';

/** Ability type for requirement definitions */
export type AbilityType = 'zeta' | 'omicron';

/**
 * A single ability requirement within an archetype.
 * Uses Comlink-native ability IDs, never display names.
 */
export interface AbilityRequirement {
  /** Unit base ID (e.g., 'DARKTROOPER', 'ADMIRALPIETT') */
  unitBaseId: string;
  
  /** 
   * Comlink ability ID (e.g., 'uniqueskill_ADMIRALPIETT01')
   * Format: {type}skill_{BASEUNIT}{SUFFIX}
   * Types: leaderskill, uniqueskill, specialskill, basicskill
   */
  abilityId: string;
  
  /** Whether this is a zeta or omicron ability */
  abilityType: AbilityType;
  
  /**
   * Optional: Modes where this ability is required.
   * If not specified, required in ALL modes.
   * E.g., an omicron might only be required in GAC modes.
   */
  modeGates?: GameMode[];
  
  /** Human-readable reason for UI/debugging */
  reason: string;
  
  /** Display name for UI (optional, can be resolved from localization) */
  displayName?: string;
}

/**
 * An optional ability that improves confidence but isn't required.
 * Missing optional abilities reduce confidence score.
 */
export interface OptionalAbilityRequirement extends AbilityRequirement {
  /** 
   * Confidence weight (0-1). How much to reduce confidence if missing.
   * E.g., 0.15 means confidence drops by 15% if this is missing.
   */
  confidenceWeight: number;
}

/**
 * Squad composition requirements beyond individual abilities.
 * Defines which units must be present for the archetype.
 */
export interface SquadCompositionRequirement {
  /** Units that MUST be in the squad */
  requiredUnits: string[];
  
  /** At least N of these units must be present */
  requireAnyOf?: {
    units: string[];
    minCount: number;
  };
  
  /** Units that should NOT be in the squad (anti-synergy) */
  excludedUnits?: string[];
  
  /** Minimum relic level for keystone units (optional) */
  minimumRelics?: {
    unitBaseId: string;
    minRelic: number;
    reason: string;
  }[];
}

/**
 * A warning associated with an archetype.
 * Can be a simple string (for backwards compatibility) or an object with relatedUnits.
 */
export interface ArchetypeWarning {
  /** The warning message to display */
  message: string;
  
  /**
   * Units this warning is about.
   * If specified, warning is only shown if at least one of these units is in the squad.
   * If not specified, warning is always shown.
   */
  relatedUnits?: string[];
}

/** Warning can be either a string or a structured ArchetypeWarning */
export type ArchetypeWarningItem = string | ArchetypeWarning;

/**
 * An archetype definition - the core config unit.
 * Archetypes describe a squad's keystone mechanics.
 */
export interface ArchetypeDefinition {
  /** Unique identifier (e.g., 'IT_VEERS_TRAIN_3V3') */
  id: string;
  
  /** Human-readable name for UI */
  displayName: string;
  
  /** Brief description of what makes this archetype work */
  description: string;
  
  /**
   * Parent archetype ID for inheritance.
   * Child inherits all requirements and can override/extend.
   */
  extends?: string;
  
  /** Game modes where this archetype is valid */
  modes: GameMode[];
  
  /** Squad composition requirements */
  composition: SquadCompositionRequirement;
  
  /**
   * Required abilities - ALL must be present for viable=true.
   * These are fail-fast: missing any = counter fails.
   */
  requiredAbilities: AbilityRequirement[];
  
  /**
   * Optional abilities - missing reduces confidence.
   * The archetype can still work without these.
   */
  optionalAbilities?: OptionalAbilityRequirement[];
  
  /**
   * Warnings to display in UI.
   * Can be strings (always shown) or objects with relatedUnits (conditionally shown).
   */
  warnings?: ArchetypeWarningItem[];
  
  /**
   * Notes for specific scenarios.
   * Key is a condition, value is the note to show.
   */
  notes?: Record<string, string>;
  
  /** Tags for categorisation/filtering */
  tags?: string[];
}

/**
 * Result of validating an archetype against a roster.
 */
export interface ArchetypeValidationResult {
  /** The archetype that was validated */
  archetypeId: string;
  
  /** Whether the counter is viable (all required abilities present) */
  viable: boolean;
  
  /**
   * Confidence score (0-100).
   * 100 = all required AND optional abilities present.
   * Decreases based on missing optional abilities.
   */
  confidence: number;
  
  /** List of missing required abilities (if any) */
  missingRequired?: {
    abilityId: string;
    unitBaseId: string;
    reason: string;
  }[];
  
  /** List of missing optional abilities with their confidence impact */
  missingOptional?: {
    abilityId: string;
    unitBaseId: string;
    reason: string;
    confidenceImpact: number;
  }[];
  
  /** Warnings from the archetype definition */
  warnings?: string[];
  
  /** Applicable notes based on roster state */
  notes?: string[];
  
  /** Human-readable summary of why this failed/succeeded */
  summary: string;
}

/**
 * Full archetype config file structure.
 */
export interface ArchetypeConfig {
  version: string;
  lastUpdated: string;
  archetypes: ArchetypeDefinition[];
}

/**
 * Mapping from squad leader to their archetype(s).
 * This connects swgoh.gg counter data to our archetype validation.
 */
export interface LeaderArchetypeMapping {
  /** The leader's base ID */
  leaderBaseId: string;
  
  /** Archetypes keyed by mode */
  archetypes: Partial<Record<GameMode, string>>;
  
  /** Default archetype if no mode-specific one exists */
  defaultArchetype?: string;
}

/**
 * Ability data extracted from Comlink for archetype building.
 */
export interface AbilityData {
  id: string;
  nameKey: string;
  descKey: string;
  isZeta: boolean;
  isOmicron: boolean;
  omicronMode?: number; // 1=TW, 2=TB, 3=Conquest, 4=Raids, 5=GAC
  tierCount: number;
}

/**
 * Unit with full ability information for archetype discovery.
 */
export interface UnitAbilityData {
  baseId: string;
  nameKey: string;
  abilities: AbilityData[];
}
