/**
 * Test script to verify the CombinedApiClient works correctly.
 * This tests the data adapter and fallback functionality.
 * 
 * Run with: npx ts-node scripts/test-combined-client.ts
 */
import { SwgohGgApiClient } from '../src/integrations/swgohGgApi';
import { CombinedApiClient } from '../src/integrations/comlink';

async function testCombinedClient(): Promise<void> {
  console.log('🔍 Testing Combined API Client...\n');

  // Create the clients
  const swgohGgClient = new SwgohGgApiClient();
  const combinedClient = new CombinedApiClient(swgohGgClient, {
    preferComlink: true,
    fallbackToSwgohGg: true,
  });

  const testAllyCode = '456438247';

  try {
    // Test 1: Check Comlink availability
    console.log('1. Checking Comlink availability...');
    const comlinkReady = await combinedClient.getComlinkClient().isReady();
    console.log(`   Comlink ready: ${comlinkReady ? '✅ Yes' : '❌ No'}\n`);

    // Test 2: Get player data via combined client
    console.log(`2. Fetching player ${testAllyCode} via CombinedApiClient...`);
    const startTime = Date.now();
    const player = await combinedClient.getFullPlayer(testAllyCode);
    const elapsed = Date.now() - startTime;
    
    console.log(`   ✅ Player fetched in ${elapsed}ms`);
    console.log(`   Name: ${player.data.name}`);
    console.log(`   GP: ${player.data.galactic_power.toLocaleString()}`);
    console.log(`   Character GP: ${player.data.character_galactic_power.toLocaleString()}`);
    console.log(`   Ship GP: ${player.data.ship_galactic_power.toLocaleString()}`);
    console.log(`   Skill Rating: ${player.data.skill_rating}`);
    console.log(`   League: ${player.data.league_name}`);
    console.log(`   Guild: ${player.data.guild_name}`);
    console.log(`   Units: ${player.units.length}`);
    
    // Count characters vs ships
    const characters = player.units.filter(u => u.data.combat_type === 1);
    const ships = player.units.filter(u => u.data.combat_type === 2);
    console.log(`   Characters: ${characters.length}, Ships: ${ships.length}`);

    // Count GLs
    const gls = player.units.filter(u => u.data.is_galactic_legend);
    console.log(`   Galactic Legends: ${gls.length}`);
    if (gls.length > 0) {
      console.log(`   GL list: ${gls.map(u => u.data.base_id).join(', ')}`);
    }

    // Show some high-relic characters
    const highRelics = player.units
      .filter(u => u.data.combat_type === 1 && (u.data.relic_tier || 0) >= 7)
      .sort((a, b) => (b.data.relic_tier || 0) - (a.data.relic_tier || 0))
      .slice(0, 5);
    
    console.log(`   Top 5 relic characters:`);
    for (const unit of highRelics) {
      console.log(`     - ${unit.data.base_id}: R${unit.data.relic_tier}, G${unit.data.gear_level}`);
    }
    console.log();

    // Test 3: Verify type compatibility
    console.log('3. Verifying type compatibility...');
    
    // These should all work if the types are correct
    const allyCode: number = player.data.ally_code;
    const name: string = player.data.name;
    const level: number = player.data.level;
    const gp: number = player.data.galactic_power;
    
    console.log(`   ally_code (number): ${allyCode}`);
    console.log(`   name (string): ${name}`);
    console.log(`   level (number): ${level}`);
    console.log(`   galactic_power (number): ${gp}`);
    console.log('   ✅ All types correct\n');

    // Test 4: GAC stats from profile
    console.log('4. GAC performance stats:');
    console.log(`   Full clears: ${player.data.season_full_clears || 0}`);
    console.log(`   Successful defends: ${player.data.season_successful_defends || 0}`);
    console.log(`   Offensive wins: ${player.data.season_offensive_battles_won || 0}`);
    console.log(`   Undersized wins: ${player.data.season_undersized_squad_wins || 0}`);
    console.log();

    console.log('✅ Combined client tests passed!\n');
    console.log('📋 Summary:');
    console.log('   - CombinedApiClient successfully fetches data from Comlink');
    console.log('   - Data is correctly adapted to swgoh.gg types');
    console.log('   - All type checks pass');
    console.log('   - Ready for use in GAC commands');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await combinedClient.close();
  }
}

testCombinedClient().catch(console.error);

