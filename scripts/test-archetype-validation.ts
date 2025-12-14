/**
 * Test script to demonstrate archetype validation against a real roster.
 * 
 * This shows:
 * 1. How to initialise the archetype validator
 * 2. How to validate a counter by leader
 * 3. How the validation result provides actionable feedback
 * 
 * Usage: npx ts-node scripts/test-archetype-validation.ts <ally-code>
 * Example: npx ts-node scripts/test-archetype-validation.ts 456438247
 */

import { comlinkClient } from '../src/integrations/comlink/comlinkClient';
import { adaptComlinkPlayerToSwgohGg } from '../src/integrations/comlink/dataAdapter';
import {
  ArchetypeValidator,
  createRosterAdapter,
  loadArchetypesConfig,
  loadLeaderMappings,
} from '../src/services/archetypeValidation';
import { GameMode } from '../src/types/archetypeTypes';

async function testArchetypeValidation(allyCode: string): Promise<void> {
  console.log('='.repeat(80));
  console.log('ARCHETYPE VALIDATION TEST');
  console.log('='.repeat(80));
  
  // 1. Fetch roster from Comlink
  console.log(`\nFetching roster for ally code: ${allyCode}...`);
  const comlinkPlayer = await comlinkClient.getPlayer(allyCode);
  const roster = adaptComlinkPlayerToSwgohGg(comlinkPlayer);
  
  console.log(`Player: ${roster.data.name}`);
  console.log(`GP: ${roster.data.galactic_power.toLocaleString()}`);
  console.log(`Units: ${roster.units.length}`);
  
  // 2. Initialise the archetype validator
  console.log('\nInitialising archetype validator...');
  const config = loadArchetypesConfig();
  const leaderMappings = loadLeaderMappings();
  const validator = new ArchetypeValidator(config, leaderMappings);
  
  const stats = validator.getStats();
  console.log(`Loaded ${stats.total} archetypes`);
  console.log(`By mode: ${JSON.stringify(stats.byMode)}`);
  
  // 3. Create roster adapter
  const rosterAdapter = createRosterAdapter(roster);
  
  // 4. Test various counters
  const testCases: Array<{ leader: string; mode: GameMode }> = [
    { leader: 'VEERS', mode: 'GAC_3v3' },
    { leader: 'VEERS', mode: 'GAC_5v5' },
    { leader: 'COMMANDERLUKESKYWALKER', mode: 'GAC_5v5' },
    { leader: 'DASHRENDAR', mode: 'GAC_3v3' },
    { leader: 'PADMEAMIDALA', mode: 'GAC_5v5' },
    { leader: 'WAMPA', mode: 'GAC_3v3' },
    { leader: 'MOTHERTALZIN', mode: 'GAC_5v5' },
  ];
  
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(80));
  
  for (const testCase of testCases) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Leader: ${testCase.leader} | Mode: ${testCase.mode}`);
    console.log('─'.repeat(60));
    
    // Check if player has the leader
    const hasLeader = rosterAdapter.hasUnit(testCase.leader);
    if (!hasLeader) {
      console.log(`  ⚠️  Player does not have ${testCase.leader} at 7★`);
      continue;
    }
    
    const leaderRelic = rosterAdapter.getRelicLevel(testCase.leader);
    console.log(`  Leader: ${testCase.leader} (R${leaderRelic ?? 'N/A'})`);
    
    // Validate the counter
    const result = validator.validateCounterByLeader(
      rosterAdapter,
      testCase.leader,
      testCase.mode
    );
    
    // Display result
    const viabilityIcon = result.viable ? '✅' : '❌';
    console.log(`  ${viabilityIcon} Viable: ${result.viable}`);
    console.log(`  📊 Confidence: ${result.confidence}%`);
    console.log(`  📝 Summary: ${result.summary}`);
    
    if (result.missingRequired && result.missingRequired.length > 0) {
      console.log('\n  Missing Required Abilities:');
      for (const missing of result.missingRequired) {
        console.log(`    ❌ ${missing.unitBaseId}: ${missing.reason}`);
      }
    }
    
    if (result.missingOptional && result.missingOptional.length > 0) {
      console.log('\n  Missing Optional Abilities:');
      for (const missing of result.missingOptional) {
        console.log(`    ⚠️  ${missing.unitBaseId} (-${missing.confidenceImpact}%): ${missing.reason}`);
      }
    }
    
    if (result.warnings && result.warnings.length > 0) {
      console.log('\n  ⚠️  Warnings:');
      for (const warning of result.warnings) {
        console.log(`    • ${warning}`);
      }
    }
  }
  
  // 5. Show example of direct archetype validation
  console.log('\n' + '='.repeat(80));
  console.log('DIRECT ARCHETYPE VALIDATION EXAMPLE');
  console.log('='.repeat(80));
  
  // Directly validate the Imperial Trooper 3v3 archetype
  const itResult = validator.validateArchetype(
    rosterAdapter,
    'IT_VEERS_TRAIN_3V3',
    'GAC_3v3'
  );
  
  console.log('\nIT_VEERS_TRAIN_3V3 validation:');
  console.log(JSON.stringify(itResult, null, 2));
  
  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

// Parse args
const allyCode = process.argv[2];
if (!allyCode) {
  console.error('Usage: npx ts-node scripts/test-archetype-validation.ts <ally-code>');
  console.error('Example: npx ts-node scripts/test-archetype-validation.ts 456438247');
  process.exit(1);
}

testArchetypeValidation(allyCode).catch(console.error);
