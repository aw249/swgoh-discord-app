/**
 * Archetype Manager Service
 * 
 * Provides runtime CRUD operations for archetypes with file persistence.
 * Supports:
 * - Adding new archetypes
 * - Updating existing archetypes
 * - Listing/searching archetypes
 * - Auto-generating archetypes from Comlink data
 * - Validation before save
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  ArchetypeDefinition, 
  ArchetypeConfig, 
  LeaderArchetypeMapping,
  GameMode,
  AbilityRequirement,
  OptionalAbilityRequirement
} from '../../types/archetypeTypes';
import { comlinkClient } from '../../integrations/comlink/comlinkClient';

// Omicron mode mapping from game data
const OMICRON_MODE_MAP: Record<number, GameMode[]> = {
  7: ['TW'],
  8: ['GAC_3v3', 'GAC_5v5'],
  9: ['TB'],
  10: ['CONQUEST'],
  11: ['GAC_3v3'],
  12: ['GAC_5v5'],
};

interface UnitAbilityInfo {
  baseId: string;
  name: string;
  abilities: Array<{
    id: string;
    name: string;
    type: 'leader' | 'special' | 'unique' | 'basic';
    isZeta: boolean;
    isOmicron: boolean;
    omicronModes?: GameMode[];
  }>;
}

interface ArchetypeManagerConfig {
  archetypesPath: string;
  mappingsPath: string;
  backupOnSave: boolean;
}

export class ArchetypeManager {
  private static instance: ArchetypeManager;
  private config: ArchetypeManagerConfig;
  private archetypes: Map<string, ArchetypeDefinition> = new Map();
  private mappings: LeaderArchetypeMapping[] = [];
  private gameDataCache: { units: Map<string, any>; skills: Map<string, any>; loc: Map<string, string> } | null = null;
  private lastLoadTime: number = 0;

  private constructor(config?: Partial<ArchetypeManagerConfig>) {
    const basePath = path.join(__dirname, '../../config/archetypes');
    this.config = {
      archetypesPath: config?.archetypesPath || path.join(basePath, 'archetypes.json'),
      mappingsPath: config?.mappingsPath || path.join(basePath, 'leaderMappings.json'),
      backupOnSave: config?.backupOnSave ?? true,
    };
    this.loadFromDisk();
  }

  static getInstance(): ArchetypeManager {
    if (!ArchetypeManager.instance) {
      ArchetypeManager.instance = new ArchetypeManager();
    }
    return ArchetypeManager.instance;
  }

  /**
   * Reload archetypes from disk
   */
  reload(): void {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const archetypesContent = fs.readFileSync(this.config.archetypesPath, 'utf-8');
      const archetypesData: ArchetypeConfig = JSON.parse(archetypesContent);
      
      this.archetypes.clear();
      for (const arch of archetypesData.archetypes) {
        this.archetypes.set(arch.id, arch);
      }

      const mappingsContent = fs.readFileSync(this.config.mappingsPath, 'utf-8');
      const mappingsData = JSON.parse(mappingsContent);
      this.mappings = mappingsData.leaderMappings || [];

      this.lastLoadTime = Date.now();
    } catch (error) {
      console.error('Failed to load archetypes:', error);
    }
  }

  /**
   * Save current state to disk
   */
  private saveToDisk(): void {
    if (this.config.backupOnSave) {
      this.createBackup();
    }

    const archetypesData: ArchetypeConfig = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      archetypes: Array.from(this.archetypes.values()),
    };

    fs.writeFileSync(
      this.config.archetypesPath,
      JSON.stringify(archetypesData, null, 2)
    );

    const mappingsData = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      leaderMappings: this.mappings,
    };

    fs.writeFileSync(
      this.config.mappingsPath,
      JSON.stringify(mappingsData, null, 2)
    );
  }

  private createBackup(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(path.dirname(this.config.archetypesPath), 'backups');
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    try {
      const archetypesContent = fs.readFileSync(this.config.archetypesPath, 'utf-8');
      fs.writeFileSync(
        path.join(backupDir, `archetypes-${timestamp}.json`),
        archetypesContent
      );
    } catch {
      // Ignore backup errors
    }
  }

  // ============ CRUD Operations ============

  /**
   * Get all archetypes
   */
  getAll(): ArchetypeDefinition[] {
    return Array.from(this.archetypes.values());
  }

  /**
   * Get archetype by ID
   */
  get(id: string): ArchetypeDefinition | undefined {
    return this.archetypes.get(id);
  }

  /**
   * Search archetypes by display name or tags
   */
  search(query: string): ArchetypeDefinition[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.archetypes.values()).filter(arch =>
      arch.displayName.toLowerCase().includes(lowerQuery) ||
      arch.id.toLowerCase().includes(lowerQuery) ||
      arch.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Add a new archetype
   */
  add(archetype: ArchetypeDefinition): { success: boolean; error?: string } {
    if (this.archetypes.has(archetype.id)) {
      return { success: false, error: `Archetype ${archetype.id} already exists` };
    }

    const validation = this.validateArchetype(archetype);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') };
    }

    this.archetypes.set(archetype.id, archetype);
    this.saveToDisk();
    return { success: true };
  }

  /**
   * Update an existing archetype
   */
  update(id: string, updates: Partial<ArchetypeDefinition>): { success: boolean; error?: string } {
    const existing = this.archetypes.get(id);
    if (!existing) {
      return { success: false, error: `Archetype ${id} not found` };
    }

    const updated: ArchetypeDefinition = { ...existing, ...updates, id }; // Prevent ID change
    const validation = this.validateArchetype(updated);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') };
    }

    this.archetypes.set(id, updated);
    this.saveToDisk();
    return { success: true };
  }

  /**
   * Delete an archetype
   */
  delete(id: string): { success: boolean; error?: string } {
    if (!this.archetypes.has(id)) {
      return { success: false, error: `Archetype ${id} not found` };
    }

    // Check if any mappings reference this archetype
    const referencingMappings = this.mappings.filter(m => 
      m.defaultArchetype === id ||
      Object.values(m.archetypes || {}).includes(id)
    );

    if (referencingMappings.length > 0) {
      return { 
        success: false, 
        error: `Cannot delete: referenced by ${referencingMappings.length} leader mapping(s)` 
      };
    }

    // Check if any archetypes extend this one
    const extending = Array.from(this.archetypes.values()).filter(a => a.extends === id);
    if (extending.length > 0) {
      return { 
        success: false, 
        error: `Cannot delete: ${extending.length} archetype(s) extend this one` 
      };
    }

    this.archetypes.delete(id);
    this.saveToDisk();
    return { success: true };
  }

  // ============ Validation ============

  private validateArchetype(arch: ArchetypeDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!arch.id || arch.id.length < 3) {
      errors.push('ID must be at least 3 characters');
    }

    if (!arch.displayName) {
      errors.push('Display name is required');
    }

    if (!arch.modes || arch.modes.length === 0) {
      errors.push('At least one mode is required');
    }

    if (!arch.composition?.requiredUnits || arch.composition.requiredUnits.length === 0) {
      if (!arch.extends) {
        errors.push('At least one required unit or extends is required');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ============ Auto-generation ============

  /**
   * Fetch and cache game data for ability lookups
   */
  private async ensureGameData(): Promise<void> {
    if (this.gameDataCache && Date.now() - this.lastLoadTime < 3600000) {
      return; // Use cache if less than 1 hour old
    }

    const gameData = await comlinkClient.getGameData() as {
      units?: any[];
      skills?: any[];
      localization?: Record<string, string>;
    };
    
    const units = new Map<string, any>();
    const skills = new Map<string, any>();
    const loc = new Map<string, string>();

    for (const unit of gameData.units || []) {
      if (unit.baseId) units.set(unit.baseId, unit);
    }

    for (const skill of gameData.skills || []) {
      if (skill.id) skills.set(skill.id, skill);
    }

    if (gameData.localization) {
      for (const [key, value] of Object.entries(gameData.localization)) {
        if (typeof value === 'string') loc.set(key, value);
      }
    }

    this.gameDataCache = { units, skills, loc };
  }

  /**
   * Get ability info for a unit
   */
  async getUnitAbilities(unitBaseId: string): Promise<UnitAbilityInfo | null> {
    await this.ensureGameData();
    if (!this.gameDataCache) return null;

    const unit = this.gameDataCache.units.get(unitBaseId);
    if (!unit) return null;

    const abilities: UnitAbilityInfo['abilities'] = [];

    for (const skillRef of unit.skillReferenceList || []) {
      const skill = this.gameDataCache.skills.get(skillRef.skillId);
      if (!skill) continue;

      let type: 'leader' | 'special' | 'unique' | 'basic' = 'basic';
      if (skillRef.skillId.startsWith('leaderskill_')) type = 'leader';
      else if (skillRef.skillId.startsWith('specialskill_')) type = 'special';
      else if (skillRef.skillId.startsWith('uniqueskill_')) type = 'unique';

      let isZeta = false;
      let isOmicron = false;
      let omicronModes: GameMode[] | undefined;

      for (const tier of skill.tiers || []) {
        if (tier.isZetaTier) isZeta = true;
        if (tier.isOmicronTier) {
          isOmicron = true;
          omicronModes = OMICRON_MODE_MAP[tier.omicronMode];
        }
      }

      abilities.push({
        id: skillRef.skillId,
        name: this.gameDataCache.loc.get(skill.nameKey) || skillRef.skillId,
        type,
        isZeta,
        isOmicron,
        omicronModes,
      });
    }

    return {
      baseId: unitBaseId,
      name: this.gameDataCache.loc.get(unit.nameKey) || unitBaseId,
      abilities,
    };
  }

  /**
   * Generate an archetype template for a unit
   */
  async generateArchetypeTemplate(unitBaseId: string): Promise<ArchetypeDefinition | null> {
    const unitInfo = await this.getUnitAbilities(unitBaseId);
    if (!unitInfo) return null;

    const leaderAbility = unitInfo.abilities.find(a => a.type === 'leader');
    if (!leaderAbility) return null; // Only generate for leaders

    const requiredAbilities: AbilityRequirement[] = [];
    const optionalAbilities: OptionalAbilityRequirement[] = [];

    // Process abilities
    for (const ability of unitInfo.abilities) {
      if (ability.isZeta) {
        const req = {
          unitBaseId,
          abilityId: ability.id,
          abilityType: 'zeta' as const,
          reason: `${unitInfo.name} ${ability.type} zeta`,
        };

        if (ability.type === 'leader' || ability.type === 'unique') {
          requiredAbilities.push(req);
        } else {
          optionalAbilities.push({ ...req, confidenceWeight: 0.10 });
        }
      }

      if (ability.isOmicron && ability.omicronModes) {
        optionalAbilities.push({
          unitBaseId,
          abilityId: ability.id,
          abilityType: 'omicron',
          confidenceWeight: 0.15,
          modeGates: ability.omicronModes,
          reason: `${unitInfo.name} ${ability.type} omicron for ${ability.omicronModes.join('/')}`,
        });
      }
    }

    return {
      id: `${unitBaseId}_TEMPLATE`,
      displayName: unitInfo.name,
      description: `Auto-generated template for ${unitInfo.name} - review and customise`,
      modes: ['GAC_5v5', 'GAC_3v3', 'TW'],
      composition: {
        requiredUnits: [unitBaseId],
      },
      requiredAbilities,
      optionalAbilities,
      tags: ['auto-generated'],
    };
  }

  /**
   * Get list of leaders without archetypes
   */
  async getMissingLeaders(): Promise<string[]> {
    await this.ensureGameData();
    if (!this.gameDataCache) return [];

    const existingLeaders = new Set<string>();
    for (const arch of this.archetypes.values()) {
      for (const unitId of arch.composition?.requiredUnits || []) {
        existingLeaders.add(unitId);
      }
    }

    const missingLeaders: string[] = [];
    for (const [baseId, unit] of this.gameDataCache.units) {
      if (unit.combatType !== 1) continue; // Characters only
      
      const hasLeadership = (unit.skillReferenceList || []).some(
        (s: { skillId: string }) => s.skillId.startsWith('leaderskill_')
      );
      
      if (hasLeadership && !existingLeaders.has(baseId)) {
        missingLeaders.push(baseId);
      }
    }

    return missingLeaders;
  }

  // ============ Leader Mappings ============

  /**
   * Add or update a leader mapping
   */
  setLeaderMapping(mapping: LeaderArchetypeMapping): void {
    const existingIdx = this.mappings.findIndex(m => m.leaderBaseId === mapping.leaderBaseId);
    if (existingIdx >= 0) {
      this.mappings[existingIdx] = mapping;
    } else {
      this.mappings.push(mapping);
    }
    this.saveToDisk();
  }

  /**
   * Get leader mapping
   */
  getLeaderMapping(leaderBaseId: string): LeaderArchetypeMapping | undefined {
    return this.mappings.find(m => m.leaderBaseId === leaderBaseId);
  }

  // ============ Statistics ============

  getStats(): {
    totalArchetypes: number;
    totalMappings: number;
    archetypesWithTeammates: number;
    averageAbilities: number;
    modesBreakdown: Record<string, number>;
  } {
    const archetypes = Array.from(this.archetypes.values());
    
    let totalAbilities = 0;
    let archetypesWithTeammates = 0;
    const modesBreakdown: Record<string, number> = {};

    for (const arch of archetypes) {
      const reqCount = arch.requiredAbilities?.length || 0;
      const optCount = arch.optionalAbilities?.length || 0;
      totalAbilities += reqCount + optCount;

      // Check for teammate abilities
      const leaderIds = new Set(arch.composition?.requiredUnits || []);
      const hasTeammateAbility = [...(arch.requiredAbilities || []), ...(arch.optionalAbilities || [])]
        .some(a => !leaderIds.has(a.unitBaseId));
      if (hasTeammateAbility) archetypesWithTeammates++;

      for (const mode of arch.modes) {
        modesBreakdown[mode] = (modesBreakdown[mode] || 0) + 1;
      }
    }

    return {
      totalArchetypes: archetypes.length,
      totalMappings: this.mappings.length,
      archetypesWithTeammates,
      averageAbilities: archetypes.length > 0 ? totalAbilities / archetypes.length : 0,
      modesBreakdown,
    };
  }
}

// Export singleton instance
export const archetypeManager = ArchetypeManager.getInstance();
