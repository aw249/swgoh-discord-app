/**
 * Script to validate archetype configuration against real Comlink data.
 * 
 * This script:
 * 1. Fetches all ability data from Comlink
 * 2. Validates that ability IDs in archetypes.json exist
 * 3. Validates that unit base IDs exist
 * 4. Suggests corrections for invalid IDs
 * 
 * Usage: npx ts-node scripts/validate-archetypes.ts
 */

import archetypesConfig from '../src/config/archetypes/archetypes.json';
import leaderMappingsConfig from '../src/config/archetypes/leaderMappings.json';
import { ArchetypeConfig, ArchetypeDefinition } from '../src/types/archetypeTypes';

const COMLINK_URL = process.env.COMLINK_URL || 'http://localhost:3200';

interface ComlinkSkillDef {
  id: string;
  nameKey: string;
}

interface ComlinkUnitDef {
  baseId: string;
  nameKey: string;
  skillReference: Array<{
    skillId: string;
  }>;
  combatType: number;
}

interface ValidationResult {
  valid: boolean;
  archetypeId: string;
  issues: string[];
  suggestions: string[];
}

async function fetchGameData(): Promise<{ units: ComlinkUnitDef[]; skills: Map<string, ComlinkSkillDef> }> {
  // First get metadata for version
  const metaRes = await fetch(`${COMLINK_URL}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {} }),
  });
  const meta = await metaRes.json() as { latestGamedataVersion: string };
  
  // Then fetch full game data
  const dataRes = await fetch(`${COMLINK_URL}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        version: meta.latestGamedataVersion,
        includePveUnits: false,
        requestSegment: 0,
      },
    }),
  });
  
  const data = await dataRes.json() as { units: ComlinkUnitDef[]; skill: ComlinkSkillDef[] };
  
  const skillMap = new Map<string, ComlinkSkillDef>();
  for (const skill of data.skill) {
    skillMap.set(skill.id, skill);
  }
  
  return { units: data.units, skills: skillMap };
}

function findSimilarIds(targetId: string, validIds: string[], maxResults = 3): string[] {
  // Simple similarity matching based on common prefixes/suffixes
  const targetLower = targetId.toLowerCase();
  const scored: Array<{ id: string; score: number }> = [];
  
  for (const id of validIds) {
    const idLower = id.toLowerCase();
    let score = 0;
    
    // Check for common substrings
    const targetParts = targetLower.split('_');
    const idParts = idLower.split('_');
    
    for (const part of targetParts) {
      if (idLower.includes(part)) score += part.length;
    }
    for (const part of idParts) {
      if (targetLower.includes(part)) score += part.length;
    }
    
    if (score > 0) {
      scored.push({ id, score });
    }
  }
  
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.id);
}

async function validateArchetypes(): Promise<void> {
  console.log('Fetching game data from Comlink...');
  const { units, skills } = await fetchGameData();
  
  // Build unit ID set
  const unitIds = new Set(units.map(u => u.baseId));
  
  // Build unit-to-skills map
  const unitSkills = new Map<string, Set<string>>();
  for (const unit of units) {
    const skillIds = new Set(unit.skillReference.map(sr => sr.skillId));
    unitSkills.set(unit.baseId, skillIds);
  }
  
  console.log(`Loaded ${unitIds.size} units and ${skills.size} skills\n`);
  
  const config = archetypesConfig as ArchetypeConfig;
  const results: ValidationResult[] = [];
  
  for (const archetype of config.archetypes) {
    const result: ValidationResult = {
      valid: true,
      archetypeId: archetype.id,
      issues: [],
      suggestions: [],
    };
    
    // Validate composition required units
    for (const unitId of archetype.composition?.requiredUnits || []) {
      if (!unitIds.has(unitId)) {
        result.valid = false;
        result.issues.push(`Unit not found: ${unitId}`);
        const similar = findSimilarIds(unitId, Array.from(unitIds));
        if (similar.length > 0) {
          result.suggestions.push(`  Did you mean: ${similar.join(', ')}?`);
        }
      }
    }
    
    // Validate composition requireAnyOf units
    for (const unitId of archetype.composition?.requireAnyOf?.units || []) {
      if (!unitIds.has(unitId)) {
        result.valid = false;
        result.issues.push(`Unit not found in requireAnyOf: ${unitId}`);
        const similar = findSimilarIds(unitId, Array.from(unitIds));
        if (similar.length > 0) {
          result.suggestions.push(`  Did you mean: ${similar.join(', ')}?`);
        }
      }
    }
    
    // Validate required abilities
    for (const ability of archetype.requiredAbilities || []) {
      // Check unit exists
      if (!unitIds.has(ability.unitBaseId)) {
        result.valid = false;
        result.issues.push(`Required ability references unknown unit: ${ability.unitBaseId}`);
        const similar = findSimilarIds(ability.unitBaseId, Array.from(unitIds));
        if (similar.length > 0) {
          result.suggestions.push(`  Did you mean: ${similar.join(', ')}?`);
        }
        continue;
      }
      
      // Check skill exists
      if (!skills.has(ability.abilityId)) {
        result.valid = false;
        result.issues.push(`Ability not found: ${ability.abilityId}`);
        
        // Find skills for this unit to suggest
        const unitSkillIds = unitSkills.get(ability.unitBaseId);
        if (unitSkillIds) {
          const similar = findSimilarIds(ability.abilityId, Array.from(unitSkillIds));
          if (similar.length > 0) {
            result.suggestions.push(`  Skills for ${ability.unitBaseId}: ${Array.from(unitSkillIds).join(', ')}`);
          }
        }
        continue;
      }
      
      // Check skill belongs to unit
      const unitSkillIds = unitSkills.get(ability.unitBaseId);
      if (unitSkillIds && !unitSkillIds.has(ability.abilityId)) {
        result.valid = false;
        result.issues.push(`Ability ${ability.abilityId} does not belong to unit ${ability.unitBaseId}`);
        result.suggestions.push(`  Valid skills for ${ability.unitBaseId}: ${Array.from(unitSkillIds).join(', ')}`);
      }
    }
    
    // Validate optional abilities
    for (const ability of archetype.optionalAbilities || []) {
      if (!unitIds.has(ability.unitBaseId)) {
        result.valid = false;
        result.issues.push(`Optional ability references unknown unit: ${ability.unitBaseId}`);
        const similar = findSimilarIds(ability.unitBaseId, Array.from(unitIds));
        if (similar.length > 0) {
          result.suggestions.push(`  Did you mean: ${similar.join(', ')}?`);
        }
        continue;
      }
      
      if (!skills.has(ability.abilityId)) {
        result.valid = false;
        result.issues.push(`Optional ability not found: ${ability.abilityId}`);
        
        const unitSkillIds = unitSkills.get(ability.unitBaseId);
        if (unitSkillIds) {
          result.suggestions.push(`  Skills for ${ability.unitBaseId}: ${Array.from(unitSkillIds).join(', ')}`);
        }
      }
    }
    
    results.push(result);
  }
  
  // Print results
  console.log('='.repeat(80));
  console.log('ARCHETYPE VALIDATION RESULTS');
  console.log('='.repeat(80));
  
  const validCount = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;
  
  console.log(`\nTotal archetypes: ${results.length}`);
  console.log(`Valid: ${validCount}`);
  console.log(`Invalid: ${invalidCount}\n`);
  
  if (invalidCount > 0) {
    console.log('ISSUES FOUND:');
    console.log('-'.repeat(80));
    
    for (const result of results.filter(r => !r.valid)) {
      console.log(`\n${result.archetypeId}:`);
      for (const issue of result.issues) {
        console.log(`  ❌ ${issue}`);
      }
      for (const suggestion of result.suggestions) {
        console.log(`     ${suggestion}`);
      }
    }
  }
  
  // Validate leader mappings
  console.log('\n' + '='.repeat(80));
  console.log('LEADER MAPPING VALIDATION');
  console.log('='.repeat(80));
  
  const mappings = (leaderMappingsConfig as { mappings: Array<{ leaderBaseId: string; archetypes: Record<string, string> }> }).mappings;
  const archetypeIds = new Set(config.archetypes.map(a => a.id));
  
  for (const mapping of mappings) {
    // Check leader exists
    if (!unitIds.has(mapping.leaderBaseId)) {
      console.log(`\n❌ Leader not found: ${mapping.leaderBaseId}`);
      const similar = findSimilarIds(mapping.leaderBaseId, Array.from(unitIds));
      if (similar.length > 0) {
        console.log(`   Did you mean: ${similar.join(', ')}?`);
      }
    }
    
    // Check archetypes exist
    for (const [mode, archetypeId] of Object.entries(mapping.archetypes)) {
      if (!archetypeIds.has(archetypeId)) {
        console.log(`\n❌ Archetype not found for ${mapping.leaderBaseId} in ${mode}: ${archetypeId}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION COMPLETE');
  console.log('='.repeat(80));
  
  if (invalidCount > 0) {
    console.log('\nTo fix issues:');
    console.log('1. Run: npx ts-node scripts/extract-ability-data.ts --leader UNIT_ID');
    console.log('2. Find the correct ability IDs from the output');
    console.log('3. Update src/config/archetypes/archetypes.json');
  }
}

validateArchetypes().catch(console.error);
