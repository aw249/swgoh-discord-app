/**
 * Archetype Validation Service
 * 
 * Exports all archetype validation functionality.
 */

export {
  ArchetypeValidator,
  createRosterAdapter,
  getArchetypeValidator,
  resetArchetypeValidator,
  type RosterAdapter,
} from './archetypeValidator';

export type {
  ArchetypeDefinition,
  ArchetypeConfig,
  ArchetypeValidationResult,
  GameMode,
  AbilityRequirement,
  OptionalAbilityRequirement,
  LeaderArchetypeMapping,
} from '../../types/archetypeTypes';

// Re-export the config loading helper
import archetypesConfig from '../../config/archetypes/archetypes.json';
import leaderMappingsConfig from '../../config/archetypes/leaderMappings.json';
import { ArchetypeConfig, LeaderArchetypeMapping } from '../../types/archetypeTypes';

/**
 * Load the archetypes configuration
 */
export function loadArchetypesConfig(): ArchetypeConfig {
  return archetypesConfig as ArchetypeConfig;
}

/**
 * Load the leader-to-archetype mappings
 */
export function loadLeaderMappings(): LeaderArchetypeMapping[] {
  return (leaderMappingsConfig as { mappings: LeaderArchetypeMapping[] }).mappings;
}
