/**
 * Archetype Validation Engine
 * 
 * This validates whether a player's roster can execute a squad archetype.
 * 
 * WHY ARCHETYPE-BASED (not counter-based):
 * - Counter lists are infinite (10,000+ matchups)
 * - Archetypes describe WHY squads work (100s of definitions)
 * - New counters auto-work if they use existing archetypes
 * - Validation focuses on keystone mechanics, not specific matchups
 * 
 * SCALING:
 * - ~100-200 archetypes cover the entire game
 * - One archetype per "squad engine" (e.g., IT_VEERS_TRAIN covers ALL IT counters)
 * - Inheritance reduces duplication (3v3 extends 5v5)
 */

import {
  ArchetypeDefinition,
  ArchetypeConfig,
  ArchetypeValidationResult,
  GameMode,
  AbilityRequirement,
  OptionalAbilityRequirement,
  LeaderArchetypeMapping,
} from '../../types/archetypeTypes';
import { SwgohGgFullPlayerResponse, SwgohGgUnit } from '../../types/swgohGgTypes';
import { logger } from '../../utils/logger';

/**
 * Roster adapter interface for dependency injection.
 * This allows the validator to work with different data sources.
 */
export interface RosterAdapter {
  /** Check if unit exists in roster at 7 stars */
  hasUnit(unitBaseId: string): boolean;
  
  /** Get unit by base ID */
  getUnit(unitBaseId: string): SwgohGgUnit | undefined;
  
  /** Check if unit has a specific zeta */
  hasZeta(unitBaseId: string, abilityId: string): boolean;
  
  /** Check if unit has a specific omicron */
  hasOmicron(unitBaseId: string, abilityId: string): boolean;
  
  /** Get unit's relic level (null if not G13) */
  getRelicLevel(unitBaseId: string): number | null;
}

/**
 * Create a roster adapter from a swgoh.gg player response
 */
export function createRosterAdapter(roster: SwgohGgFullPlayerResponse): RosterAdapter {
  const unitMap = new Map<string, SwgohGgUnit>();
  
  for (const unit of roster.units || []) {
    unitMap.set(unit.data.base_id, unit);
  }
  
  return {
    hasUnit(unitBaseId: string): boolean {
      const unit = unitMap.get(unitBaseId);
      return unit !== undefined && unit.data.rarity >= 7;
    },
    
    getUnit(unitBaseId: string): SwgohGgUnit | undefined {
      return unitMap.get(unitBaseId);
    },
    
    hasZeta(unitBaseId: string, abilityId: string): boolean {
      const unit = unitMap.get(unitBaseId);
      if (!unit) return false;
      return unit.data.zeta_abilities.includes(abilityId);
    },
    
    hasOmicron(unitBaseId: string, abilityId: string): boolean {
      const unit = unitMap.get(unitBaseId);
      if (!unit) return false;
      return unit.data.omicron_abilities.includes(abilityId);
    },
    
    getRelicLevel(unitBaseId: string): number | null {
      const unit = unitMap.get(unitBaseId);
      if (!unit) return null;
      if (unit.data.gear_level < 13) return null;
      if (unit.data.relic_tier === null) return null;
      return Math.max(0, unit.data.relic_tier - 2);
    },
  };
}

/**
 * Main archetype validator class.
 */
export class ArchetypeValidator {
  private archetypes: Map<string, ArchetypeDefinition> = new Map();
  private resolvedArchetypes: Map<string, ArchetypeDefinition> = new Map();
  private leaderMappings: Map<string, LeaderArchetypeMapping> = new Map();
  
  constructor(config: ArchetypeConfig, leaderMappings?: LeaderArchetypeMapping[]) {
    this.loadConfig(config);
    if (leaderMappings) {
      this.loadLeaderMappings(leaderMappings);
    }
  }
  
  /**
   * Load archetype config and resolve inheritance
   */
  private loadConfig(config: ArchetypeConfig): void {
    // First pass: load all archetypes
    for (const archetype of config.archetypes) {
      this.archetypes.set(archetype.id, archetype);
    }
    
    // Second pass: resolve inheritance
    for (const archetype of config.archetypes) {
      const resolved = this.resolveInheritance(archetype);
      this.resolvedArchetypes.set(archetype.id, resolved);
    }
    
    logger.info(`Loaded ${this.archetypes.size} archetypes, resolved ${this.resolvedArchetypes.size}`);
  }
  
  /**
   * Load leader-to-archetype mappings
   */
  private loadLeaderMappings(mappings: LeaderArchetypeMapping[]): void {
    for (const mapping of mappings) {
      this.leaderMappings.set(mapping.leaderBaseId, mapping);
    }
    logger.info(`Loaded ${this.leaderMappings.size} leader-to-archetype mappings`);
  }
  
  /**
   * Resolve inheritance for an archetype.
   * Child properties override parent properties.
   * Arrays are merged (child extends parent).
   */
  private resolveInheritance(archetype: ArchetypeDefinition): ArchetypeDefinition {
    if (!archetype.extends) {
      return { ...archetype };
    }
    
    const parent = this.archetypes.get(archetype.extends);
    if (!parent) {
      logger.warn(`Archetype ${archetype.id} extends unknown parent ${archetype.extends}`);
      return { ...archetype };
    }
    
    // Recursively resolve parent first
    const resolvedParent = this.resolveInheritance(parent);
    
    // Merge composition
    const composition = {
      requiredUnits: [
        ...(resolvedParent.composition?.requiredUnits || []),
        ...(archetype.composition?.requiredUnits || []),
      ].filter((v, i, a) => a.indexOf(v) === i), // dedupe
      
      requireAnyOf: archetype.composition?.requireAnyOf || resolvedParent.composition?.requireAnyOf,
      excludedUnits: archetype.composition?.excludedUnits || resolvedParent.composition?.excludedUnits,
      minimumRelics: [
        ...(resolvedParent.composition?.minimumRelics || []),
        ...(archetype.composition?.minimumRelics || []),
      ],
    };
    
    // Merge abilities (child adds to parent)
    const requiredAbilities = [
      ...(resolvedParent.requiredAbilities || []),
      ...(archetype.requiredAbilities || []),
    ];
    
    const optionalAbilities = [
      ...(resolvedParent.optionalAbilities || []),
      ...(archetype.optionalAbilities || []),
    ];
    
    // Merge warnings
    const warnings = [
      ...(resolvedParent.warnings || []),
      ...(archetype.warnings || []),
    ];
    
    // Merge notes (child overrides parent)
    const notes = {
      ...(resolvedParent.notes || {}),
      ...(archetype.notes || {}),
    };
    
    // Merge tags
    const tags = [
      ...(resolvedParent.tags || []),
      ...(archetype.tags || []),
    ].filter((v, i, a) => a.indexOf(v) === i);
    
    return {
      ...resolvedParent,
      ...archetype,
      composition,
      requiredAbilities,
      optionalAbilities,
      warnings,
      notes,
      tags,
    };
  }
  
  /**
   * Get a resolved archetype by ID
   */
  getArchetype(archetypeId: string): ArchetypeDefinition | undefined {
    return this.resolvedArchetypes.get(archetypeId);
  }
  
  /**
   * Get all archetypes for a given mode
   */
  getArchetypesForMode(mode: GameMode): ArchetypeDefinition[] {
    return Array.from(this.resolvedArchetypes.values())
      .filter(a => a.modes.includes(mode));
  }
  
  /**
   * Look up the archetype for a squad leader in a given mode
   */
  getArchetypeForLeader(leaderBaseId: string, mode: GameMode): string | null {
    const mapping = this.leaderMappings.get(leaderBaseId);
    if (!mapping) return null;
    
    return mapping.archetypes[mode] || mapping.defaultArchetype || null;
  }
  
  /**
   * Validate whether a roster can execute an archetype.
   * 
   * @param roster - The player's roster adapter
   * @param archetypeId - The archetype to validate
   * @param mode - The game mode (affects omicron requirements)
   * @returns Validation result with viability, confidence, and reasons
   */
  validateArchetype(
    roster: RosterAdapter,
    archetypeId: string,
    mode: GameMode
  ): ArchetypeValidationResult {
    const archetype = this.resolvedArchetypes.get(archetypeId);
    
    if (!archetype) {
      return {
        archetypeId,
        viable: false,
        confidence: 0,
        summary: `Unknown archetype: ${archetypeId}`,
      };
    }
    
    // Check mode compatibility
    if (!archetype.modes.includes(mode)) {
      return {
        archetypeId,
        viable: false,
        confidence: 0,
        summary: `Archetype ${archetype.displayName} is not valid for mode ${mode}`,
      };
    }
    
    const missingRequired: ArchetypeValidationResult['missingRequired'] = [];
    const missingOptional: ArchetypeValidationResult['missingOptional'] = [];
    const applicableNotes: string[] = [];
    
    // 1. Check squad composition
    const compositionResult = this.validateComposition(roster, archetype.composition);
    if (!compositionResult.valid) {
      return {
        archetypeId,
        viable: false,
        confidence: 0,
        summary: compositionResult.reason,
      };
    }
    
    // 2. Check required abilities
    for (const req of archetype.requiredAbilities) {
      // Check mode gate
      if (req.modeGates && req.modeGates.length > 0) {
        if (!req.modeGates.includes(mode)) {
          // This requirement doesn't apply to current mode
          continue;
        }
      }
      
      const hasAbility = this.checkAbility(roster, req);
      
      if (!hasAbility) {
        missingRequired.push({
          abilityId: req.abilityId,
          unitBaseId: req.unitBaseId,
          reason: req.reason,
        });
      }
    }
    
    // 3. Calculate confidence from optional abilities
    let confidence = 100;
    
    for (const opt of archetype.optionalAbilities || []) {
      // Check mode gate
      if (opt.modeGates && opt.modeGates.length > 0) {
        if (!opt.modeGates.includes(mode)) {
          continue;
        }
      }
      
      const hasAbility = this.checkAbility(roster, opt);
      
      if (!hasAbility) {
        const impact = Math.round(opt.confidenceWeight * 100);
        confidence -= impact;
        missingOptional.push({
          abilityId: opt.abilityId,
          unitBaseId: opt.unitBaseId,
          reason: opt.reason,
          confidenceImpact: impact,
        });
      }
    }
    
    // 4. Check minimum relic requirements
    for (const relicReq of archetype.composition.minimumRelics || []) {
      const relic = roster.getRelicLevel(relicReq.unitBaseId);
      if (relic === null || relic < relicReq.minRelic) {
        confidence -= 20;
        missingOptional.push({
          abilityId: 'RELIC_REQUIREMENT',
          unitBaseId: relicReq.unitBaseId,
          reason: relicReq.reason,
          confidenceImpact: 20,
        });
      }
    }
    
    // 5. Determine viability
    const viable = missingRequired.length === 0;
    confidence = Math.max(0, Math.min(100, confidence));
    
    // 6. Build summary
    let summary: string;
    if (!viable) {
      const missingList = missingRequired.map(m => 
        `${m.unitBaseId}: ${m.reason}`
      ).join('; ');
      summary = `Missing required abilities: ${missingList}`;
    } else if (confidence < 100) {
      summary = `Viable with ${confidence}% confidence. Missing optional: ${missingOptional.map(m => m.unitBaseId).join(', ')}`;
    } else {
      summary = `Fully configured - all required and optional abilities present`;
    }
    
    return {
      archetypeId,
      viable,
      confidence,
      missingRequired: missingRequired.length > 0 ? missingRequired : undefined,
      missingOptional: missingOptional.length > 0 ? missingOptional : undefined,
      warnings: archetype.warnings,
      notes: applicableNotes.length > 0 ? applicableNotes : undefined,
      summary,
    };
  }
  
  /**
   * Validate a counter by leader base ID.
   * Automatically looks up the appropriate archetype.
   */
  validateCounterByLeader(
    roster: RosterAdapter,
    leaderBaseId: string,
    mode: GameMode
  ): ArchetypeValidationResult {
    const archetypeId = this.getArchetypeForLeader(leaderBaseId, mode);
    
    if (!archetypeId) {
      // No archetype defined for this leader - return permissive result
      return {
        archetypeId: 'NONE',
        viable: true,
        confidence: 50, // Neutral confidence
        summary: `No archetype validation defined for ${leaderBaseId}. Using win rate data only.`,
        warnings: ['No archetype validation available - viability based on swgoh.gg data only'],
      };
    }
    
    return this.validateArchetype(roster, archetypeId, mode);
  }
  
  /**
   * Check if a specific ability is present on a unit
   */
  private checkAbility(roster: RosterAdapter, req: AbilityRequirement): boolean {
    if (!roster.hasUnit(req.unitBaseId)) {
      return false;
    }
    
    if (req.abilityType === 'zeta') {
      return roster.hasZeta(req.unitBaseId, req.abilityId);
    } else {
      return roster.hasOmicron(req.unitBaseId, req.abilityId);
    }
  }
  
  /**
   * Validate squad composition requirements
   */
  private validateComposition(
    roster: RosterAdapter,
    composition: ArchetypeDefinition['composition']
  ): { valid: boolean; reason: string } {
    // Check required units
    for (const unitId of composition.requiredUnits) {
      if (!roster.hasUnit(unitId)) {
        return {
          valid: false,
          reason: `Missing required unit: ${unitId}`,
        };
      }
    }
    
    // Check requireAnyOf
    if (composition.requireAnyOf) {
      const { units, minCount } = composition.requireAnyOf;
      const presentCount = units.filter(u => roster.hasUnit(u)).length;
      if (presentCount < minCount) {
        return {
          valid: false,
          reason: `Need at least ${minCount} of: ${units.join(', ')}. Only have ${presentCount}`,
        };
      }
    }
    
    return { valid: true, reason: '' };
  }
  
  /**
   * Validate multiple archetypes and return the best match.
   * Useful when a squad could match multiple archetypes.
   */
  findBestMatchingArchetype(
    roster: RosterAdapter,
    archetypeIds: string[],
    mode: GameMode
  ): ArchetypeValidationResult | null {
    let bestResult: ArchetypeValidationResult | null = null;
    
    for (const id of archetypeIds) {
      const result = this.validateArchetype(roster, id, mode);
      
      if (!result.viable) continue;
      
      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    }
    
    return bestResult;
  }
  
  /**
   * Get statistics about loaded archetypes
   */
  getStats(): { total: number; byMode: Record<string, number>; byTag: Record<string, number> } {
    const byMode: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    
    for (const archetype of this.resolvedArchetypes.values()) {
      for (const mode of archetype.modes) {
        byMode[mode] = (byMode[mode] || 0) + 1;
      }
      for (const tag of archetype.tags || []) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }
    
    return {
      total: this.resolvedArchetypes.size,
      byMode,
      byTag,
    };
  }
}

// Singleton instance
let validatorInstance: ArchetypeValidator | null = null;

/**
 * Get or create the singleton validator instance
 */
export function getArchetypeValidator(
  config?: ArchetypeConfig,
  leaderMappings?: LeaderArchetypeMapping[]
): ArchetypeValidator {
  if (!validatorInstance && config) {
    validatorInstance = new ArchetypeValidator(config, leaderMappings);
  }
  if (!validatorInstance) {
    throw new Error('ArchetypeValidator not initialised. Call with config first.');
  }
  return validatorInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetArchetypeValidator(): void {
  validatorInstance = null;
}
