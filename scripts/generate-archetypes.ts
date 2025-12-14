#!/usr/bin/env npx ts-node
/**
 * Auto-generate archetype templates from Comlink game data
 * 
 * This script:
 * 1. Fetches all units with leadership abilities
 * 2. Identifies zetas and omicrons for each unit
 * 3. Generates archetype templates with required/optional abilities
 * 4. Outputs JSON that can be merged into archetypes.json
 * 
 * Usage:
 *   npx ts-node scripts/generate-archetypes.ts --all
 *   npx ts-node scripts/generate-archetypes.ts --unit DARTHVADER
 *   npx ts-node scripts/generate-archetypes.ts --faction empire
 *   npx ts-node scripts/generate-archetypes.ts --missing (only units not in archetypes.json)
 */

import * as fs from 'fs';
import * as path from 'path';

const COMLINK_URL = process.env.COMLINK_URL || 'http://localhost:3200';

interface AbilityInfo {
  id: string;
  name: string;
  isZeta: boolean;
  isOmicron: boolean;
  omicronMode?: number;
  type: 'leader' | 'special' | 'unique' | 'basic';
}

interface UnitAbilityData {
  baseId: string;
  name: string;
  combatType: number; // 1 = character, 2 = ship
  categoryIds: string[];
  abilities: AbilityInfo[];
  hasLeadership: boolean;
}

interface GeneratedArchetype {
  id: string;
  displayName: string;
  description: string;
  modes: string[];
  composition: {
    requiredUnits: string[];
  };
  requiredAbilities: Array<{
    unitBaseId: string;
    abilityId: string;
    abilityType: 'zeta' | 'omicron';
    reason: string;
    modeGates?: string[];
  }>;
  optionalAbilities: Array<{
    unitBaseId: string;
    abilityId: string;
    abilityType: 'zeta' | 'omicron';
    confidenceWeight: number;
    reason: string;
    modeGates?: string[];
  }>;
  tags: string[];
  _generated: boolean;
  _needsReview: boolean;
}

// Omicron mode mapping from game data
// Mode 1 = base/no omicron (applies to 1600+ skills), NOT an actual omicron
const OMICRON_MODE_MAP: Record<number, string[]> = {
  // 1: undefined - NOT an omicron, this is a base ability flag
  4: ['GUILD_ACTIVITIES'],  // Guild raids/events (Boushh, Scout Trooper)
  7: ['TW'],                // Territory War
  8: ['GAC_3v3', 'GAC_5v5'], // Grand Arena (both formats)
  9: ['TB'],                // Territory Battle
  10: ['CONQUEST'],         // Conquest
  11: ['GAC_3v3'],          // GAC 3v3 only
  12: ['GAC_5v5'],          // GAC 5v5 only
  14: ['GAC_3v3', 'GAC_5v5'], // GAC (Moff Tarkin, Tusken Chieftain)
  15: ['GAC_3v3', 'GAC_5v5'], // GAC (Doctor Aphra)
};

function getOmicronModes(omicronMode?: number): string[] | undefined {
  // Mode 1 is not an actual omicron - it's a base ability flag
  if (!omicronMode || omicronMode === 1) return undefined;
  return OMICRON_MODE_MAP[omicronMode];
}

function getAbilityType(skillId: string): AbilityInfo['type'] {
  if (skillId.startsWith('leaderskill_')) return 'leader';
  if (skillId.startsWith('specialskill_')) return 'special';
  if (skillId.startsWith('uniqueskill_')) return 'unique';
  return 'basic';
}

function getFactionTag(categoryIds: string[]): string[] {
  const factionMap: Record<string, string> = {
    'profession_bountyhunter': 'bounty-hunters',
    'profession_smuggler': 'scoundrels',
    'affiliation_empire': 'empire',
    'affiliation_rebels': 'rebels',
    'affiliation_firstorder': 'first-order',
    'affiliation_resistance': 'resistance',
    'affiliation_separatist': 'separatists',
    'affiliation_galacticrepublic': 'galactic-republic',
    'affiliation_nightsisters': 'nightsisters',
    'affiliation_sithempire': 'sith-empire',
    'affiliation_oldrepublic': 'old-republic',
    'species_mandalorian': 'mandalorians',
    'species_ewok': 'ewoks',
    'species_tusken': 'tuskens',
    'species_jawa': 'jawas',
    'affiliation_imperialtrooper': 'imperial-troopers',
    'affiliation_501st': '501st',
    'profession_jedi': 'jedi',
    'profession_sith': 'sith',
  };
  
  const tags: string[] = [];
  for (const catId of categoryIds) {
    const tag = factionMap[catId.toLowerCase()];
    if (tag) tags.push(tag);
  }
  return tags;
}

async function fetchLocalization(): Promise<Map<string, string>> {
  const metaRes = await fetch(`${COMLINK_URL}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {} }),
  });
  const meta = await metaRes.json() as { latestLocalizationBundleVersion: string };
  
  const locRes = await fetch(`${COMLINK_URL}/localization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      unzip: true,
      payload: { id: meta.latestLocalizationBundleVersion },
    }),
  });
  
  const data = await locRes.json() as Record<string, string>;
  const engData = data['Loc_ENG_US.txt'];
  
  const locMap = new Map<string, string>();
  if (engData) {
    const lines = engData.split('\n');
    for (const line of lines) {
      const pipeIndex = line.indexOf('|');
      if (pipeIndex > 0) {
        locMap.set(line.substring(0, pipeIndex), line.substring(pipeIndex + 1));
      }
    }
  }
  return locMap;
}

function isBasePlayableUnit(baseId: string): boolean {
  const variantPatterns = [
    '_GLE_INHERIT', '_GLE', '_GL_EVENT', '_GLAHSOKAEVENT',
    'YOUREXCELLENCY', '_DUMMY', '_CONQUEST', '_TB',
    '_TW', '_RAID', '_TUTORIAL', '_BOSS', '_HOLIDAY',
    '_PLAYER', '_BACKUP', '_TEST', '_REV_',
  ];
  return !variantPatterns.some(p => baseId.includes(p));
}

async function fetchUnitAbilities(): Promise<UnitAbilityData[]> {
  console.log('Fetching game data from Comlink...');
  
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
  const gameData = await dataRes.json() as {
    units?: any[];
    skill?: any[];
  };
  
  // Fetch localization
  const locMap = await fetchLocalization();
  
  const unitMap = new Map<string, any>();
  const skillMap = new Map<string, any>();
  
  // Build skill map (note: API returns 'skill' not 'skills')
  for (const skill of gameData.skill || []) {
    skillMap.set(skill.id, skill);
  }
  
  console.log(`Loaded ${skillMap.size} skills`);
  
  // Process units - use skillReference not skillReferenceList
  for (const unit of gameData.units || []) {
    if (!unit.baseId) continue;
    if (!isBasePlayableUnit(unit.baseId)) continue;
    unitMap.set(unit.baseId, unit);
  }
  
  console.log(`Loaded ${unitMap.size} playable units`);
  
  const results: UnitAbilityData[] = [];
  
  for (const [baseId, unit] of unitMap) {
    // Note: Comlink uses skillReference, not skillReferenceList
    const skillRefs = unit.skillReference || unit.skillReferenceList || [];
    const abilities: AbilityInfo[] = [];
    let hasLeadership = false;
    
    for (const skillRef of skillRefs) {
      const skill = skillMap.get(skillRef.skillId);
      if (!skill) continue;
      
      const skillType = getAbilityType(skillRef.skillId);
      if (skillType === 'leader') hasLeadership = true;
      
      // Check for zeta/omicron - these are direct properties on the skill
      // Note: omicronMode === 1 is a base ability flag, NOT an actual omicron
      const isZeta = skill.isZeta === true;
      const isOmicron = skill.omicronMode !== undefined && skill.omicronMode > 1;
      const omicronMode: number | undefined = skill.omicronMode;
      
      // Only include abilities with zetas or omicrons
      if (isZeta || isOmicron || skillType === 'leader') {
        const nameKey = skill.nameKey || '';
        abilities.push({
          id: skillRef.skillId,
          name: locMap.get(nameKey) || nameKey,
          isZeta,
          isOmicron,
          omicronMode,
          type: skillType,
        });
      }
    }
    
    if (abilities.length > 0) {
      results.push({
        baseId,
        name: locMap.get(unit.nameKey) || baseId,
        combatType: unit.combatType || 1,
        categoryIds: unit.categoryIdList || [],
        abilities,
        hasLeadership,
      });
    }
  }
  
  console.log(`Found ${results.length} units with zetas/omicrons`);
  return results;
}

function generateArchetypeForUnit(unit: UnitAbilityData): GeneratedArchetype | null {
  // Only generate for units with leadership
  if (!unit.hasLeadership || unit.combatType !== 1) return null;
  
  const leaderAbility = unit.abilities.find(a => a.type === 'leader');
  if (!leaderAbility) return null;
  
  const tags = getFactionTag(unit.categoryIds);
  const archetypeId = `${unit.baseId}_GENERATED`;
  
  const requiredAbilities: GeneratedArchetype['requiredAbilities'] = [];
  const optionalAbilities: GeneratedArchetype['optionalAbilities'] = [];
  
  // Leadership zeta is always required if it exists
  if (leaderAbility.isZeta) {
    requiredAbilities.push({
      unitBaseId: unit.baseId,
      abilityId: leaderAbility.id,
      abilityType: 'zeta',
      reason: `${unit.name} leadership zeta provides core squad mechanics`,
    });
  }
  
  // Leadership omicron creates mode-specific variant
  if (leaderAbility.isOmicron && leaderAbility.omicronMode) {
    const modeGates = getOmicronModes(leaderAbility.omicronMode);
    requiredAbilities.push({
      unitBaseId: unit.baseId,
      abilityId: leaderAbility.id,
      abilityType: 'omicron',
      reason: `${unit.name} leadership omicron enhances squad in specific modes`,
      modeGates,
    });
  }
  
  // Process other abilities
  for (const ability of unit.abilities) {
    if (ability.type === 'leader') continue; // Already processed
    
    if (ability.isZeta) {
      if (ability.type === 'unique') {
        // Unique zetas are typically required
        requiredAbilities.push({
          unitBaseId: unit.baseId,
          abilityId: ability.id,
          abilityType: 'zeta',
          reason: `${unit.name} unique zeta enhances core mechanics`,
        });
      } else {
        // Special zetas are typically optional
        optionalAbilities.push({
          unitBaseId: unit.baseId,
          abilityId: ability.id,
          abilityType: 'zeta',
          confidenceWeight: 0.10,
          reason: `${unit.name} special zeta provides additional utility`,
        });
      }
    }
    
    if (ability.isOmicron && ability.omicronMode) {
      const modeGates = getOmicronModes(ability.omicronMode);
      optionalAbilities.push({
        unitBaseId: unit.baseId,
        abilityId: ability.id,
        abilityType: 'omicron',
        confidenceWeight: 0.15,
        reason: `${unit.name} ${ability.type} omicron for specific game modes`,
        modeGates,
      });
    }
  }
  
  // Determine modes based on omicrons present
  let modes = ['GAC_5v5', 'GAC_3v3', 'TW'];
  
  return {
    id: archetypeId,
    displayName: unit.name,
    description: `Auto-generated archetype for ${unit.name} - needs review`,
    modes,
    composition: {
      requiredUnits: [unit.baseId],
    },
    requiredAbilities,
    optionalAbilities,
    tags,
    _generated: true,
    _needsReview: true,
  };
}

async function loadExistingArchetypes(): Promise<Set<string>> {
  const archetypesPath = path.join(__dirname, '../src/config/archetypes/archetypes.json');
  try {
    const content = fs.readFileSync(archetypesPath, 'utf-8');
    const data = JSON.parse(content);
    const unitIds = new Set<string>();
    
    for (const arch of data.archetypes || []) {
      // Extract unit IDs from composition
      if (arch.composition?.requiredUnits) {
        for (const unitId of arch.composition.requiredUnits) {
          unitIds.add(unitId);
        }
      }
    }
    
    return unitIds;
  } catch {
    return new Set();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {
    all: args.includes('--all'),
    missing: args.includes('--missing'),
    unit: args.find((a, i) => args[i - 1] === '--unit'),
    faction: args.find((a, i) => args[i - 1] === '--faction'),
    output: args.find((a, i) => args[i - 1] === '--output') || 'generated-archetypes.json',
  };
  
  if (!flags.all && !flags.missing && !flags.unit && !flags.faction) {
    console.log(`
Usage:
  npx ts-node scripts/generate-archetypes.ts --all
  npx ts-node scripts/generate-archetypes.ts --missing
  npx ts-node scripts/generate-archetypes.ts --unit DARTHVADER
  npx ts-node scripts/generate-archetypes.ts --faction empire
  
Options:
  --all      Generate for all leaders
  --missing  Only generate for leaders not in archetypes.json
  --unit     Generate for specific unit
  --faction  Generate for all leaders in a faction
  --output   Output file path (default: generated-archetypes.json)
`);
    return;
  }
  
  const units = await fetchUnitAbilities();
  const existingUnits = await loadExistingArchetypes();
  
  let filtered = units;
  
  if (flags.missing) {
    filtered = units.filter(u => !existingUnits.has(u.baseId));
    console.log(`Found ${filtered.length} units not in current archetypes`);
  }
  
  if (flags.unit) {
    filtered = units.filter(u => 
      u.baseId.toLowerCase().includes(flags.unit!.toLowerCase())
    );
  }
  
  if (flags.faction) {
    filtered = units.filter(u => 
      u.categoryIds.some(c => c.toLowerCase().includes(flags.faction!.toLowerCase()))
    );
  }
  
  const archetypes: GeneratedArchetype[] = [];
  
  for (const unit of filtered) {
    const archetype = generateArchetypeForUnit(unit);
    if (archetype) {
      archetypes.push(archetype);
    }
  }
  
  console.log(`\nGenerated ${archetypes.length} archetype templates\n`);
  
  // Output to file
  const outputPath = path.join(__dirname, flags.output);
  fs.writeFileSync(outputPath, JSON.stringify({ archetypes }, null, 2));
  console.log(`Written to: ${outputPath}`);
  
  // Also print summary
  console.log('\nGenerated archetypes:');
  for (const arch of archetypes.slice(0, 20)) {
    console.log(`  - ${arch.id}: ${arch.displayName} (${arch.requiredAbilities.length} required, ${arch.optionalAbilities.length} optional)`);
  }
  
  if (archetypes.length > 20) {
    console.log(`  ... and ${archetypes.length - 20} more`);
  }
}

main().catch(console.error);
