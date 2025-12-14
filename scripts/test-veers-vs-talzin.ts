/**
 * Test script to validate Veers/Piett/Dark Trooper vs Talzin/Merrin/Zombie counter.
 * 
 * Usage: npx ts-node scripts/test-veers-vs-talzin.ts <player-ally-code> <opponent-ally-code>
 */

import { SwgohGgApiClient } from '../src/integrations/swgohGgApi';

// Ability requirements for Imperial Troopers
// Veers lead with Piett is very zeta-dependent!
const ABILITY_REQUIREMENTS = {
  zetas: {
    VEERS: [
      // NOTE: Veers leadership does NOT require a zeta - it works by default
      // His only zeta is on his unique ability
      {
        abilityId: 'uniqueskill_VEERS01',
        abilityName: 'Ruthless Assault',
        reason: 'Provides bonus damage and assists when Empire allies attack out of turn',
        priority: 'recommended'  // Good to have but leadership works without it
      }
    ],
    ADMIRALPIETT: [
      {
        abilityId: 'uniqueskill_ADMIRALPIETT01',
        abilityName: 'The Emperor\'s Trap',
        reason: 'Provides counter chance, TM gain, and trap stacks - core mechanic for Trooper combo',
        priority: 'required'
      },
      {
        abilityId: 'specialskill_ADMIRALPIETT02',
        abilityName: 'Suborbital Strike',
        reason: 'Dispels buffs, deals AoE damage, inflicts Daze - important for control',
        priority: 'recommended'  // Good to have but trap mechanic is the essential one
      }
    ],
    DARKTROOPER: [
      {
        abilityId: 'uniqueskill_DARKTROOPER01',
        abilityName: 'Programmed Loyalty',
        reason: 'Provides bonus damage and assists - core to Trooper damage output',
        priority: 'recommended'  // Good to have but not essential
      }
    ],
    // Nightsister abilities to check on defense
    MOTHERTALZIN: [
      {
        abilityId: 'leaderskill_MOTHERTALZIN',
        abilityName: 'Nightsister Swarm',
        reason: 'Leadership provides Plague mechanics and revival',
        priority: 'required'
      },
      {
        abilityId: 'uniqueskill_MOTHERTALZIN01',
        abilityName: 'The Great Mother',
        reason: 'Provides revival and bonus turn mechanics',
        priority: 'required'
      }
    ],
    MERRIN: [
      {
        abilityId: 'uniqueskill_MERRIN01',
        abilityName: 'Nightsister Magick',
        reason: 'Dispel and buff immunity on basic, plus healing',
        priority: 'recommended'
      }
    ],
    NIGHTSISTERZOMBIE: [
      {
        abilityId: 'uniqueskill_NIGHTSISTERZOMBIE01',
        abilityName: 'Endless Horde',
        reason: 'Auto-revive mechanic - the whole point of Zombie',
        priority: 'required'
      }
    ]
  },
  omicrons: {
    // Check for any relevant omicrons
    VEERS: [],
    ADMIRALPIETT: [],
    DARKTROOPER: [],
    MOTHERTALZIN: [],
    MERRIN: [
      {
        abilityId: 'uniqueskill_MERRIN01',  // Merrin has a GAC omicron
        abilityName: 'Nightsister Magick (GAC Omicron)',
        reason: 'GAC omicron provides massive stat boosts and healing - significantly strengthens Nightsister defense',
        priority: 'recommended'
      }
    ],
    NIGHTSISTERZOMBIE: []
  }
};

async function testCounter(playerAllyCode: string, opponentAllyCode: string) {
  console.log('='.repeat(80));
  console.log('COUNTER TEST: Veers/Piett/Dark Trooper vs Talzin/Merrin/Zombie');
  console.log('='.repeat(80));

  const client = new SwgohGgApiClient();

  try {
    // Fetch both rosters
    console.log(`\nFetching player roster (${playerAllyCode})...`);
    const playerRoster = await client.getFullPlayer(playerAllyCode);
    
    console.log(`Fetching opponent roster (${opponentAllyCode})...`);
    const opponentRoster = await client.getFullPlayer(opponentAllyCode);

    console.log('\n' + '='.repeat(80));
    console.log('PLAYER ROSTER ANALYSIS');
    console.log('='.repeat(80));
    console.log(`Player: ${playerRoster.data.name} (${playerRoster.data.galactic_power.toLocaleString()} GP)`);

    // Check player's offense units
    const offenseUnits = ['VEERS', 'ADMIRALPIETT', 'DARKTROOPER'];
    
    for (const baseId of offenseUnits) {
      const unit = playerRoster.units.find(u => u.data.base_id === baseId);
      console.log(`\n${baseId}`);
      console.log('-'.repeat(60));

      if (!unit) {
        console.log('  ❌ NOT IN ROSTER');
        continue;
      }

      // Calculate relic level
      let relicLevel: number | null = null;
      if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
        relicLevel = Math.max(0, unit.data.relic_tier - 2);
      }

      console.log(`  ${unit.data.name}`);
      console.log(`  Stars: ${unit.data.rarity}★ | Gear: G${unit.data.gear_level} | Relic: ${relicLevel !== null ? `R${relicLevel}` : 'N/A'}`);
      console.log(`  Zetas: [${unit.data.zeta_abilities.join(', ') || 'none'}]`);
      console.log(`  Omicrons: [${unit.data.omicron_abilities.join(', ') || 'none'}]`);

      // Check requirements
      const zetaReqs = ABILITY_REQUIREMENTS.zetas[baseId as keyof typeof ABILITY_REQUIREMENTS.zetas] || [];
      const omiReqs = ABILITY_REQUIREMENTS.omicrons[baseId as keyof typeof ABILITY_REQUIREMENTS.omicrons] || [];

      if (zetaReqs.length > 0) {
        console.log('\n  Required Zetas:');
        for (const req of zetaReqs) {
          const hasIt = unit.data.zeta_abilities.includes(req.abilityId);
          const icon = hasIt ? '✅' : (req.priority === 'required' ? '❌' : '⚠️');
          console.log(`    ${icon} ${req.abilityName}`);
          if (!hasIt) {
            console.log(`       └─ ${req.reason}`);
          }
        }
      }

      if (omiReqs.length > 0) {
        console.log('\n  Required Omicrons:');
        for (const req of omiReqs) {
          const hasIt = unit.data.omicron_abilities.includes(req.abilityId);
          const icon = hasIt ? '✅' : (req.priority === 'required' ? '❌' : '⚠️');
          console.log(`    ${icon} ${req.abilityName}`);
          if (!hasIt) {
            console.log(`       └─ ${req.reason}`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('OPPONENT ROSTER ANALYSIS');
    console.log('='.repeat(80));
    console.log(`Opponent: ${opponentRoster.data.name} (${opponentRoster.data.galactic_power.toLocaleString()} GP)`);

    // Check opponent's defense units
    const defenseUnits = ['MOTHERTALZIN', 'MERRIN', 'NIGHTSISTERZOMBIE'];
    
    for (const baseId of defenseUnits) {
      const unit = opponentRoster.units.find(u => u.data.base_id === baseId);
      console.log(`\n${baseId}`);
      console.log('-'.repeat(60));

      if (!unit) {
        console.log('  ❌ NOT IN ROSTER');
        continue;
      }

      // Calculate relic level
      let relicLevel: number | null = null;
      if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
        relicLevel = Math.max(0, unit.data.relic_tier - 2);
      }

      console.log(`  ${unit.data.name}`);
      console.log(`  Stars: ${unit.data.rarity}★ | Gear: G${unit.data.gear_level} | Relic: ${relicLevel !== null ? `R${relicLevel}` : 'N/A'}`);
      console.log(`  Zetas: [${unit.data.zeta_abilities.join(', ') || 'none'}]`);
      console.log(`  Omicrons: [${unit.data.omicron_abilities.join(', ') || 'none'}]`);

      // Check for threatening abilities
      const zetaReqs = ABILITY_REQUIREMENTS.zetas[baseId as keyof typeof ABILITY_REQUIREMENTS.zetas] || [];
      const omiReqs = ABILITY_REQUIREMENTS.omicrons[baseId as keyof typeof ABILITY_REQUIREMENTS.omicrons] || [];

      if (zetaReqs.length > 0 || omiReqs.length > 0) {
        console.log('\n  Key Abilities to Watch:');
        for (const req of zetaReqs) {
          const hasIt = unit.data.zeta_abilities.includes(req.abilityId);
          const icon = hasIt ? '⚠️ HAS' : '✅ Missing';
          console.log(`    ${icon} ${req.abilityName}`);
        }
        for (const req of omiReqs) {
          const hasIt = unit.data.omicron_abilities.includes(req.abilityId);
          const icon = hasIt ? '🔴 HAS OMICRON' : '✅ No Omicron';
          console.log(`    ${icon} ${req.abilityName}`);
        }
      }
    }

    // Counter viability analysis
    console.log('\n' + '='.repeat(80));
    console.log('COUNTER VIABILITY ANALYSIS');
    console.log('='.repeat(80));

    // Check player's offense readiness
    const veers = playerRoster.units.find(u => u.data.base_id === 'VEERS');
    const piett = playerRoster.units.find(u => u.data.base_id === 'ADMIRALPIETT');
    const darkTrooper = playerRoster.units.find(u => u.data.base_id === 'DARKTROOPER');

    const hasAllUnits = veers && piett && darkTrooper;
    const allAt7Stars = veers?.data.rarity === 7 && piett?.data.rarity === 7 && darkTrooper?.data.rarity === 7;

    console.log('\n📋 OFFENSE: Veers + Piett + Dark Trooper');
    console.log('-'.repeat(60));

    if (!hasAllUnits) {
      console.log('  ❌ MISSING UNITS - Cannot use this counter');
    } else if (!allAt7Stars) {
      console.log('  ⚠️ Not all units at 7 stars');
    } else {
      console.log('  ✅ Has all units at 7 stars');

      // Check critical abilities
      // NOTE: Veers leadership works WITHOUT a zeta - his unique zeta is nice but not required
      const veersHasUnique = veers.data.zeta_abilities.includes('uniqueskill_VEERS01');
      const piettHasTrap = piett.data.zeta_abilities.includes('uniqueskill_ADMIRALPIETT01');
      const piettHasSuborbital = piett.data.zeta_abilities.includes('specialskill_ADMIRALPIETT02');

      console.log('\n  Critical Ability Check:');
      console.log(`    ✅ Veers Leadership (no zeta required - works by default)`);
      console.log(`    ${veersHasUnique ? '✅' : '⚠️'} Veers "Ruthless Assault" Zeta (recommended)`);
      console.log(`    ${piettHasTrap ? '✅' : '❌'} Piett "The Emperor\'s Trap" Zeta (required)`);
      console.log(`    ${piettHasSuborbital ? '✅' : '⚠️'} Piett "Suborbital Strike" Zeta (recommended)`);

      // Core requirement: Piett's trap zeta is essential, Suborbital is nice-to-have
      const meetsRequirements = piettHasTrap;

      if (meetsRequirements) {
        console.log('\n  ✅ ALL CRITICAL ABILITIES IN PLACE');
        console.log('  → This counter WOULD BE RECOMMENDED by the new system');
      } else {
        console.log('\n  ❌ MISSING CRITICAL ABILITIES');
        if (!piettHasTrap) {
          console.log('     - Piett "The Emperor\'s Trap" is ESSENTIAL for TM gain and trap mechanic');
        }
        console.log('  → This counter WOULD BE SKIPPED by the new system');
      }
    }

    // Check opponent's defense strength
    const talzin = opponentRoster.units.find(u => u.data.base_id === 'MOTHERTALZIN');
    const merrin = opponentRoster.units.find(u => u.data.base_id === 'MERRIN');
    const zombie = opponentRoster.units.find(u => u.data.base_id === 'NIGHTSISTERZOMBIE');

    console.log('\n📋 DEFENSE: Talzin + Merrin + Zombie');
    console.log('-'.repeat(60));

    if (talzin && merrin && zombie) {
      // Calculate relic levels
      const talzinRelic = talzin.data.gear_level >= 13 && talzin.data.relic_tier ? talzin.data.relic_tier - 2 : null;
      const merrinRelic = merrin.data.gear_level >= 13 && merrin.data.relic_tier ? merrin.data.relic_tier - 2 : null;
      const zombieRelic = zombie.data.gear_level >= 13 && zombie.data.relic_tier ? zombie.data.relic_tier - 2 : null;

      console.log(`  Talzin: R${talzinRelic ?? 'N/A'} | Merrin: R${merrinRelic ?? 'N/A'} | Zombie: R${zombieRelic ?? 'N/A'}`);

      // Check for threatening omicrons
      const merrinHasOmicron = merrin.data.omicron_abilities.length > 0;
      if (merrinHasOmicron) {
        console.log('\n  🔴 WARNING: Merrin has GAC Omicron!');
        console.log('     This significantly strengthens the Nightsister defense');
        console.log('     Troopers may struggle if under-geared');
      } else {
        console.log('\n  ✅ Merrin does NOT have GAC Omicron');
        console.log('     Defense is at standard strength');
      }

      // Check Talzin lead
      const talzinHasLead = talzin.data.zeta_abilities.includes('leaderskill_MOTHERTALZIN');
      const talzinHasUnique = talzin.data.zeta_abilities.includes('uniqueskill_MOTHERTALZIN01');
      if (talzinHasLead && talzinHasUnique) {
        console.log('\n  ⚠️ Talzin has both leadership and unique zetas');
        console.log('     Full Plague and revival mechanics active');
      }
    }

    // Relic comparison
    console.log('\n' + '='.repeat(80));
    console.log('RELIC COMPARISON');
    console.log('='.repeat(80));

    if (hasAllUnits && talzin && merrin && zombie) {
      const getRelicLevel = (unit: any) => {
        if (unit.data.gear_level >= 13 && unit.data.relic_tier !== null) {
          return Math.max(0, unit.data.relic_tier - 2);
        }
        return 0;
      };

      const offenseRelics = [getRelicLevel(veers), getRelicLevel(piett), getRelicLevel(darkTrooper)];
      const defenseRelics = [getRelicLevel(talzin), getRelicLevel(merrin), getRelicLevel(zombie)];

      const avgOffense = offenseRelics.reduce((a, b) => a + b, 0) / offenseRelics.length;
      const avgDefense = defenseRelics.reduce((a, b) => a + b, 0) / defenseRelics.length;
      const delta = avgOffense - avgDefense;

      console.log(`\n  Offense: Veers R${offenseRelics[0]}, Piett R${offenseRelics[1]}, Dark Trooper R${offenseRelics[2]}`);
      console.log(`  Defense: Talzin R${defenseRelics[0]}, Merrin R${defenseRelics[1]}, Zombie R${defenseRelics[2]}`);
      console.log(`\n  Average Offense Relic: ${avgOffense.toFixed(1)}`);
      console.log(`  Average Defense Relic: ${avgDefense.toFixed(1)}`);
      console.log(`  Relic Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`);

      if (delta < -2) {
        console.log('\n  ⚠️ SIGNIFICANT RELIC DISADVANTAGE');
        console.log('     This counter may be risky even with proper zetas');
      } else if (delta >= 0) {
        console.log('\n  ✅ Favorable or neutral relic matchup');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('FINAL VERDICT');
    console.log('='.repeat(80));

    // Final analysis
    if (hasAllUnits && allAt7Stars && veers && piett) {
      // Piett's trap zeta is the critical requirement - Veers leadership works without a zeta
      const piettHasTrap = piett.data.zeta_abilities.includes('uniqueskill_ADMIRALPIETT01');
      const meetsRequirements = piettHasTrap;

      if (meetsRequirements) {
        console.log('\n  ✅ UNDER NEW SYSTEM: Counter would be RECOMMENDED');
        console.log('     Piett has "The Emperor\'s Trap" zeta for TM gain and trap mechanic');
        console.log('     Veers leadership provides TM train without needing a zeta');
      } else {
        console.log('\n  ❌ UNDER NEW SYSTEM: Counter would be SKIPPED');
        console.log('     Piett is missing "The Emperor\'s Trap" zeta');
        console.log('     This is the core mechanic for the Trooper combo');
      }
    } else {
      console.log('\n  ❌ Counter not viable - missing units or stars');
    }

    console.log('\n' + '='.repeat(80));

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

// Run the test
const playerAllyCode = process.argv[2];
const opponentAllyCode = process.argv[3];

if (!playerAllyCode || !opponentAllyCode) {
  console.error('Usage: npx ts-node scripts/test-veers-vs-talzin.ts <player-ally-code> <opponent-ally-code>');
  console.error('Example: npx ts-node scripts/test-veers-vs-talzin.ts 594719274 862596589');
  process.exit(1);
}

testCounter(playerAllyCode, opponentAllyCode);

