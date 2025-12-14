/**
 * Test script to validate ability requirements checking logic.
 * 
 * Usage: npx ts-node scripts/test-ability-requirements.ts <ally-code>
 * Example: npx ts-node scripts/test-ability-requirements.ts 456438247
 */

import { SwgohGgApiClient } from '../src/integrations/swgohGgApi';

// Define the ability requirements we want to test
// NOTE: swgoh.gg uses format like:
//   - leaderskill_BASEID for leadership abilities
//   - uniqueskill_BASEID01, uniqueskill_BASEID02 for unique abilities  
//   - specialskill_BASEID01, specialskill_BASEID02 for special abilities
//   - Omicrons appear in the same array as zetas when applied
const ABILITY_REQUIREMENTS = {
  zetas: {
    DASHRENDAR: [
      {
        abilityId: 'leaderskill_DASHRENDAR',
        abilityName: 'Underworld Connections (Leadership Zeta)',
        reason: 'Leadership provides Scoundrel/Smuggler synergy'
      }
    ],
    CHEWBACCALEGENDARY: [
      {
        abilityId: 'uniqueskill_CHEWBACCALEGENDARY01',
        abilityName: 'Loyal Friend',
        reason: 'Guard mechanic protects weakest ally - essential for survivability'
      }
    ],
    HANSOLO: [
      {
        abilityId: 'uniqueskill_HANSOLO01',
        abilityName: 'Shoots First',
        reason: 'Provides critical first-turn damage and TM manipulation'
      }
    ],
    COMMANDERLUKESKYWALKER: [
      {
        abilityId: 'leaderskill_COMMANDERLUKESKYWALKER',
        abilityName: 'Rebel Maneuvers',
        reason: 'Leadership provides TM manipulation and survivability'
      },
      {
        abilityId: 'uniqueskill_COMMANDERLUKESKYWALKER01',
        abilityName: 'Learn Control',
        reason: 'Guard and bonus turn mechanics'
      }
    ],
    WAMPA: [
      {
        abilityId: 'uniqueskill_WAMPA02',
        abilityName: 'Cornered Beast',
        reason: 'Survivability and damage scaling'
      }
    ]
  },
  omicrons: {
    DASHRENDAR: [
      {
        abilityId: 'leaderskill_DASHRENDAR',  // Omicron is on the leadership
        abilityName: 'Underworld Connections (GAC Omicron)',
        reason: 'GAC omicron provides massive TM manipulation and damage boost - essential for the counter'
      }
    ],
    WAMPA: [
      {
        abilityId: 'uniqueskill_WAMPA02',  // Omicron is on the unique (Furious Foe)
        abilityName: 'Furious Foe (GAC Omicron)',
        reason: 'GAC omicron enables solo counters - without it Wampa cannot solo most teams'
      }
    ]
  }
};

interface AbilityCheckResult {
  baseId: string;
  name: string;
  hasUnit: boolean;
  rarity: number | null;
  relicLevel: number | null;
  gearLevel: number | null;
  zetasApplied: string[];
  omicronsApplied: string[];
  requiredZetas: { abilityId: string; abilityName: string; hasIt: boolean; reason: string }[];
  requiredOmicrons: { abilityId: string; abilityName: string; hasIt: boolean; reason: string }[];
  meetsZetaRequirements: boolean;
  meetsOmicronRequirements: boolean;
}

async function testAbilityRequirements(allyCode: string) {
  console.log('='.repeat(80));
  console.log('ABILITY REQUIREMENTS TEST');
  console.log('='.repeat(80));
  console.log(`\nFetching roster for ally code: ${allyCode}...\n`);

  const client = new SwgohGgApiClient();

  try {
    const roster = await client.getFullPlayer(allyCode);
    
    console.log(`Player: ${roster.data.name}`);
    console.log(`GP: ${roster.data.galactic_power.toLocaleString()}`);
    console.log(`Units: ${roster.units.length}`);
    console.log('\n' + '='.repeat(80));

    // Characters to check
    const charactersToCheck = [
      'DASHRENDAR',
      'CHEWBACCALEGENDARY', 
      'HANSOLO',
      'COMMANDERLUKESKYWALKER',
      'WAMPA'
    ];

    const results: AbilityCheckResult[] = [];

    for (const baseId of charactersToCheck) {
      const unit = roster.units.find(u => u.data.base_id === baseId);
      
      const zetaRequirements = ABILITY_REQUIREMENTS.zetas[baseId as keyof typeof ABILITY_REQUIREMENTS.zetas] || [];
      const omicronRequirements = ABILITY_REQUIREMENTS.omicrons[baseId as keyof typeof ABILITY_REQUIREMENTS.omicrons] || [];

      if (!unit) {
        results.push({
          baseId,
          name: baseId,
          hasUnit: false,
          rarity: null,
          relicLevel: null,
          gearLevel: null,
          zetasApplied: [],
          omicronsApplied: [],
          requiredZetas: zetaRequirements.map(z => ({ ...z, hasIt: false })),
          requiredOmicrons: omicronRequirements.map(o => ({ ...o, hasIt: false })),
          meetsZetaRequirements: zetaRequirements.length === 0,
          meetsOmicronRequirements: omicronRequirements.length === 0
        });
        continue;
      }

      // Calculate relic level
      let relicLevel: number | null = null;
      if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
        relicLevel = Math.max(0, unit.data.relic_tier - 2);
      }

      // Check zetas
      const zetaResults = zetaRequirements.map(req => ({
        ...req,
        hasIt: unit.data.zeta_abilities.includes(req.abilityId)
      }));

      // Check omicrons
      const omicronResults = omicronRequirements.map(req => ({
        ...req,
        hasIt: unit.data.omicron_abilities.includes(req.abilityId)
      }));

      results.push({
        baseId,
        name: unit.data.name,
        hasUnit: true,
        rarity: unit.data.rarity,
        relicLevel,
        gearLevel: unit.data.gear_level,
        zetasApplied: unit.data.zeta_abilities,
        omicronsApplied: unit.data.omicron_abilities,
        requiredZetas: zetaResults,
        requiredOmicrons: omicronResults,
        meetsZetaRequirements: zetaResults.every(z => z.hasIt),
        meetsOmicronRequirements: omicronResults.every(o => o.hasIt)
      });
    }

    // Display results
    for (const result of results) {
      console.log(`\n${result.name} (${result.baseId})`);
      console.log('-'.repeat(60));

      if (!result.hasUnit) {
        console.log('  ❌ NOT IN ROSTER');
        continue;
      }

      console.log(`  Stars: ${result.rarity}★ | Gear: G${result.gearLevel} | Relic: ${result.relicLevel !== null ? `R${result.relicLevel}` : 'N/A'}`);
      
      // Zetas
      console.log('\n  ZETAS:');
      if (result.requiredZetas.length === 0) {
        console.log('    No required zetas defined');
      } else {
        for (const zeta of result.requiredZetas) {
          const status = zeta.hasIt ? '✅' : '❌';
          console.log(`    ${status} ${zeta.abilityName}`);
          if (!zeta.hasIt) {
            console.log(`       └─ WHY NEEDED: ${zeta.reason}`);
          }
        }
      }
      console.log(`    All zetas applied: [${result.zetasApplied.join(', ') || 'none'}]`);

      // Omicrons
      console.log('\n  OMICRONS:');
      if (result.requiredOmicrons.length === 0) {
        console.log('    No required omicrons defined');
      } else {
        for (const omi of result.requiredOmicrons) {
          const status = omi.hasIt ? '✅' : '❌';
          console.log(`    ${status} ${omi.abilityName}`);
          if (!omi.hasIt) {
            console.log(`       └─ WHY NEEDED: ${omi.reason}`);
          }
        }
      }
      console.log(`    All omicrons applied: [${result.omicronsApplied.join(', ') || 'none'}]`);

      // Summary
      const meetsAll = result.meetsZetaRequirements && result.meetsOmicronRequirements;
      console.log(`\n  VERDICT: ${meetsAll ? '✅ MEETS ALL REQUIREMENTS' : '⚠️ MISSING REQUIRED ABILITIES'}`);
    }

    // Counter viability analysis
    console.log('\n' + '='.repeat(80));
    console.log('COUNTER VIABILITY ANALYSIS');
    console.log('='.repeat(80));

    // Dash/Chewie/Han counter
    const dashResult = results.find(r => r.baseId === 'DASHRENDAR');
    const chewieResult = results.find(r => r.baseId === 'CHEWBACCALEGENDARY');
    const hanResult = results.find(r => r.baseId === 'HANSOLO');

    console.log('\n📋 COUNTER: Dash Rendar + Chewbacca + Han Solo (3v3)');
    console.log('-'.repeat(60));

    const dashChewieHanViable = 
      dashResult?.hasUnit && 
      chewieResult?.hasUnit && 
      hanResult?.hasUnit &&
      dashResult?.rarity === 7 &&
      chewieResult?.rarity === 7 &&
      hanResult?.rarity === 7;

    if (!dashChewieHanViable) {
      console.log('  ❌ NOT VIABLE - Missing units or not at 7 stars');
    } else {
      console.log('  ✅ Has all units at 7 stars');
      
      const dashMeetsReqs = dashResult.meetsZetaRequirements && dashResult.meetsOmicronRequirements;
      const chewieMeetsReqs = chewieResult.meetsZetaRequirements && chewieResult.meetsOmicronRequirements;
      const hanMeetsReqs = hanResult.meetsZetaRequirements && hanResult.meetsOmicronRequirements;

      if (dashMeetsReqs && chewieMeetsReqs && hanMeetsReqs) {
        console.log('  ✅ ALL ABILITY REQUIREMENTS MET');
        console.log('  → This counter would be RECOMMENDED by the system');
      } else {
        console.log('  ⚠️ MISSING ABILITY REQUIREMENTS:');
        if (!dashMeetsReqs) {
          const missing = [...dashResult.requiredZetas.filter(z => !z.hasIt), ...dashResult.requiredOmicrons.filter(o => !o.hasIt)];
          for (const m of missing) {
            console.log(`     - Dash: ${m.abilityName}`);
          }
        }
        if (!chewieMeetsReqs) {
          const missing = [...chewieResult.requiredZetas.filter(z => !z.hasIt), ...chewieResult.requiredOmicrons.filter(o => !o.hasIt)];
          for (const m of missing) {
            console.log(`     - Chewbacca: ${m.abilityName}`);
          }
        }
        if (!hanMeetsReqs) {
          const missing = [...hanResult.requiredZetas.filter(z => !z.hasIt), ...hanResult.requiredOmicrons.filter(o => !o.hasIt)];
          for (const m of missing) {
            console.log(`     - Han Solo: ${m.abilityName}`);
          }
        }
        console.log('  → This counter would be SKIPPED by the system');
      }
    }

    // Wampa solo counter
    const wampaResult = results.find(r => r.baseId === 'WAMPA');

    console.log('\n📋 COUNTER: Wampa Solo');
    console.log('-'.repeat(60));

    if (!wampaResult?.hasUnit || wampaResult.rarity !== 7) {
      console.log('  ❌ NOT VIABLE - Missing Wampa or not at 7 stars');
    } else {
      console.log(`  ✅ Has Wampa at 7 stars (R${wampaResult.relicLevel ?? 'N/A'})`);
      
      const wampaMeetsReqs = wampaResult.meetsZetaRequirements && wampaResult.meetsOmicronRequirements;

      if (wampaMeetsReqs) {
        console.log('  ✅ ALL ABILITY REQUIREMENTS MET (including GAC Omicron!)');
        console.log('  → Wampa solo counters would be RECOMMENDED by the system');
      } else {
        console.log('  ⚠️ MISSING ABILITY REQUIREMENTS:');
        const missing = [...wampaResult.requiredZetas.filter(z => !z.hasIt), ...wampaResult.requiredOmicrons.filter(o => !o.hasIt)];
        for (const m of missing) {
          console.log(`     - ${m.abilityName}`);
          console.log(`       Reason: ${m.reason}`);
        }
        console.log('  → Wampa solo counters would be SKIPPED by the system');
      }
    }

    // CLS Rebels counter
    const clsResult = results.find(r => r.baseId === 'COMMANDERLUKESKYWALKER');

    console.log('\n📋 COUNTER: CLS Rebels (CLS + Threepio/Chewie + C-3PO + Chewie + Han)');
    console.log('-'.repeat(60));

    if (!clsResult?.hasUnit || clsResult.rarity !== 7) {
      console.log('  ❌ NOT VIABLE - Missing CLS or not at 7 stars');
    } else {
      console.log(`  ✅ Has CLS at 7 stars (R${clsResult.relicLevel ?? 'N/A'})`);
      
      if (clsResult.meetsZetaRequirements) {
        console.log('  ✅ CLS zeta requirements met');
        console.log('  → CLS Rebels counters would be RECOMMENDED by the system');
      } else {
        console.log('  ⚠️ MISSING CLS ZETA REQUIREMENTS:');
        const missing = clsResult.requiredZetas.filter(z => !z.hasIt);
        for (const m of missing) {
          console.log(`     - ${m.abilityName}`);
        }
        console.log('  → CLS Rebels counters would be SKIPPED by the system');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

// Run the test
const allyCode = process.argv[2];
if (!allyCode) {
  console.error('Usage: npx ts-node scripts/test-ability-requirements.ts <ally-code>');
  console.error('Example: npx ts-node scripts/test-ability-requirements.ts 456438247');
  process.exit(1);
}

testAbilityRequirements(allyCode);

