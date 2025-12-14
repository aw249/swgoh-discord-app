/**
 * Script to extract all unit abilities from Comlink.
 * 
 * This helps us:
 * 1. Discover all ability IDs for archetype configuration
 * 2. Identify which abilities have zetas/omicrons
 * 3. Generate archetype templates for leaders
 * 
 * Usage: npx ts-node scripts/extract-ability-data.ts [--leader LEADER_ID] [--json]
 * 
 * Examples:
 *   npx ts-node scripts/extract-ability-data.ts --leader VEERS
 *   npx ts-node scripts/extract-ability-data.ts --leader GLREY --json
 *   npx ts-node scripts/extract-ability-data.ts --all-leaders > leaders.json
 */

import { AbilityData, UnitAbilityData } from '../src/types/archetypeTypes';

const COMLINK_URL = process.env.COMLINK_URL || 'http://localhost:3200';

interface ComlinkSkillDef {
  id: string;
  nameKey: string;
  descKey: string;
  tierList: Array<{
    isZetaTier: boolean;
    isOmicronTier: boolean;
  }>;
  isZeta?: boolean;
  omicronMode?: number;
}

interface ComlinkUnitDef {
  baseId: string;
  nameKey: string;
  skillReference: Array<{
    skillId: string;
    requiredTier: number;
  }>;
  categoryId: string[];
  combatType: number;
}

interface ComlinkGameData {
  units: ComlinkUnitDef[];
  skill: ComlinkSkillDef[];
}

async function fetchGameData(): Promise<ComlinkGameData> {
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
  
  return await dataRes.json() as ComlinkGameData;
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
  const lines = engData.split('\n');
  for (const line of lines) {
    const pipeIndex = line.indexOf('|');
    if (pipeIndex > 0) {
      locMap.set(line.substring(0, pipeIndex), line.substring(pipeIndex + 1));
    }
  }
  return locMap;
}

function getOmicronModeName(mode: number | undefined): string {
  switch (mode) {
    case 1: return 'TW';
    case 2: return 'TB';
    case 3: return 'Conquest';
    case 4: return 'Raids';
    case 5: return 'GAC';
    case 6: return 'GAC_3v3';
    case 7: return 'GAC_5v5';
    default: return 'Unknown';
  }
}

function isBasePlayableUnit(baseId: string): boolean {
  const variantPatterns = [
    '_GLE_INHERIT', '_GLE', '_GL_EVENT', '_GLAHSOKAEVENT',
    '_SPEEDERBIKERAID', '_T4_HERO', '_T6', '_NOULT', '_STANDARD'
  ];
  return !variantPatterns.some(p => baseId.toUpperCase().includes(p));
}

function isLeader(categories: string[]): boolean {
  // Check for leadership category or if unit has a leader skill
  return categories.some(c => 
    c.includes('leader') || 
    c.includes('capital') ||
    c === 'galactic_legend'
  );
}

async function extractAbilityData(targetLeader?: string, allLeaders = false, jsonOutput = false) {
  console.error('Fetching game data from Comlink...');
  const gameData = await fetchGameData();
  const localization = await fetchLocalization();
  
  // Build skill map
  const skillMap = new Map<string, ComlinkSkillDef>();
  for (const skill of gameData.skill) {
    skillMap.set(skill.id, skill);
  }
  
  // Find target units
  let targetUnits: ComlinkUnitDef[];
  if (targetLeader) {
    targetUnits = gameData.units.filter(u => 
      u.baseId.toUpperCase().includes(targetLeader.toUpperCase()) &&
      isBasePlayableUnit(u.baseId)
    );
  } else if (allLeaders) {
    // Get all units that could be leaders (have leadership abilities)
    targetUnits = gameData.units.filter(u => {
      if (!isBasePlayableUnit(u.baseId)) return false;
      if (u.combatType !== 1) return false; // Characters only
      
      // Check if they have a leadership skill
      return u.skillReference.some(sr => sr.skillId.startsWith('leaderskill_'));
    });
  } else {
    console.error('Usage: --leader LEADER_ID or --all-leaders');
    process.exit(1);
  }
  
  if (targetUnits.length === 0) {
    console.error(`No units found for: ${targetLeader}`);
    process.exit(1);
  }
  
  const results: UnitAbilityData[] = [];
  
  for (const unit of targetUnits) {
    const unitName = localization.get(unit.nameKey) || unit.baseId;
    
    const abilities: AbilityData[] = [];
    
    for (const skillRef of unit.skillReference) {
      const skill = skillMap.get(skillRef.skillId);
      if (!skill) continue;
      
      // Determine if this skill has a zeta or omicron
      const hasZeta = skill.isZeta === true || 
        skill.tierList?.some(t => t.isZetaTier);
      const hasOmicron = skill.tierList?.some(t => t.isOmicronTier);
      
      abilities.push({
        id: skill.id,
        nameKey: skill.nameKey,
        descKey: skill.descKey,
        isZeta: hasZeta,
        isOmicron: hasOmicron,
        omicronMode: skill.omicronMode,
        tierCount: skill.tierList?.length || 0,
      });
    }
    
    results.push({
      baseId: unit.baseId,
      nameKey: unit.nameKey,
      abilities,
    });
  }
  
  if (jsonOutput) {
    // Output as JSON for piping to file
    const output = results.map(unit => {
      const unitName = localization.get(unit.nameKey) || unit.baseId;
      return {
        baseId: unit.baseId,
        name: unitName,
        abilities: unit.abilities.map(a => ({
          id: a.id,
          name: localization.get(a.nameKey) || a.nameKey,
          isZeta: a.isZeta,
          isOmicron: a.isOmicron,
          omicronMode: a.isOmicron ? getOmicronModeName(a.omicronMode) : undefined,
        })),
      };
    });
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Pretty print for console
    for (const unit of results) {
      const unitName = localization.get(unit.nameKey) || unit.baseId;
      console.log('='.repeat(80));
      console.log(`${unitName} (${unit.baseId})`);
      console.log('='.repeat(80));
      
      for (const ability of unit.abilities) {
        const abilityName = localization.get(ability.nameKey) || ability.nameKey;
        const markers: string[] = [];
        if (ability.isZeta) markers.push('ZETA');
        if (ability.isOmicron) markers.push(`OMICRON (${getOmicronModeName(ability.omicronMode)})`);
        
        const markerStr = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
        console.log(`  ${ability.id}${markerStr}`);
        console.log(`    Name: ${abilityName}`);
        console.log('');
      }
    }
  }
  
  // Generate archetype template suggestion
  if (!jsonOutput && targetLeader && results.length === 1) {
    const unit = results[0];
    const unitName = localization.get(unit.nameKey) || unit.baseId;
    
    console.log('\n' + '='.repeat(80));
    console.log('SUGGESTED ARCHETYPE TEMPLATE');
    console.log('='.repeat(80));
    
    const zetaAbilities = unit.abilities.filter(a => a.isZeta);
    const omicronAbilities = unit.abilities.filter(a => a.isOmicron);
    const leaderAbility = unit.abilities.find(a => a.id.startsWith('leaderskill_'));
    
    const template = {
      id: `${unit.baseId}_STANDARD`,
      displayName: `${unitName} Standard`,
      description: `${unitName} with core zetas`,
      modes: ['GAC_5v5', 'GAC_3v3', 'TW'],
      composition: {
        requiredUnits: [unit.baseId],
      },
      requiredAbilities: [
        // Suggest leader zeta if exists
        ...(leaderAbility && leaderAbility.isZeta ? [{
          unitBaseId: unit.baseId,
          abilityId: leaderAbility.id,
          abilityType: 'zeta',
          reason: `${localization.get(leaderAbility.nameKey) || 'Leadership'} provides the core squad synergy`,
        }] : []),
        // Suggest unique zetas
        ...zetaAbilities
          .filter(a => a.id.startsWith('uniqueskill_'))
          .slice(0, 2)
          .map(a => ({
            unitBaseId: unit.baseId,
            abilityId: a.id,
            abilityType: 'zeta',
            reason: `${localization.get(a.nameKey) || a.id} - [FILL IN REASON]`,
          })),
      ],
      optionalAbilities: zetaAbilities
        .filter(a => !a.id.startsWith('leaderskill_') && !a.id.startsWith('uniqueskill_'))
        .map(a => ({
          unitBaseId: unit.baseId,
          abilityId: a.id,
          abilityType: 'zeta',
          confidenceWeight: 0.1,
          reason: `${localization.get(a.nameKey) || a.id} - [FILL IN REASON]`,
        })),
      tags: [],
    };
    
    // Add GAC omicron variant if exists
    const gacOmicrons = omicronAbilities.filter(a => a.omicronMode === 5 || a.omicronMode === 6 || a.omicronMode === 7);
    if (gacOmicrons.length > 0) {
      console.log('\n// GAC Omicron variant:');
      const gacTemplate = {
        id: `${unit.baseId}_GAC_OMICRON`,
        displayName: `${unitName} (GAC Omicron)`,
        description: `${unitName} with GAC omicron for enhanced performance`,
        extends: `${unit.baseId}_STANDARD`,
        modes: ['GAC_3v3', 'GAC_5v5'],
        requiredAbilities: gacOmicrons.map(a => ({
          unitBaseId: unit.baseId,
          abilityId: a.id,
          abilityType: 'omicron',
          modeGates: ['GAC_3v3', 'GAC_5v5'],
          reason: `GAC omicron on ${localization.get(a.nameKey) || a.id} - essential for GAC performance`,
        })),
      };
      console.log(JSON.stringify(gacTemplate, null, 2));
    }
    
    console.log('\n// Base archetype:');
    console.log(JSON.stringify(template, null, 2));
  }
}

// Parse args
const args = process.argv.slice(2);
const leaderIdx = args.indexOf('--leader');
const allLeaders = args.includes('--all-leaders');
const jsonOutput = args.includes('--json');

const targetLeader = leaderIdx >= 0 ? args[leaderIdx + 1] : undefined;

extractAbilityData(targetLeader, allLeaders, jsonOutput).catch(console.error);
