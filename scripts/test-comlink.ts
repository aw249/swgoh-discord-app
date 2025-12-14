/**
 * Test script to verify Comlink integration is working correctly.
 * 
 * Run with: npx ts-node scripts/test-comlink.ts
 * 
 * Prerequisites:
 * - Comlink server running at http://localhost:3200
 * - Start with: ./bin/swgoh-comlink-4.0.0 --port 3200
 */
import { ComlinkClient, GacLeague, GacDivision } from '../src/integrations/comlink';

async function testComlink(): Promise<void> {
  const client = new ComlinkClient({ url: 'http://localhost:3200' });

  console.log('🔍 Testing Comlink Integration...\n');

  // Test 1: Check if service is ready
  console.log('1. Checking service readiness...');
  const ready = await client.isReady();
  console.log(`   ✅ Service ready: ${ready}\n`);

  if (!ready) {
    console.error('❌ Comlink service is not running. Start it with:');
    console.error('   ./bin/swgoh-comlink-4.0.0 --port 3200');
    process.exit(1);
  }

  // Test 2: Get current GAC events
  console.log('2. Fetching current GAC events...');
  try {
    const gacEvents = await client.getCurrentGacEvents();
    console.log(`   ✅ Found ${gacEvents.length} GAC event(s):`);
    for (const event of gacEvents) {
      const format = event.seasonDefId.includes('3v3') ? '3v3' : '5v5';
      const seasonMatch = event.id.match(/SEASON_(\d+)/);
      const season = seasonMatch ? seasonMatch[1] : 'unknown';
      console.log(`      - Season ${season} (${format})`);
      console.log(`        Status: ${event.status === 2 ? 'Active' : event.status}`);
      if (event.instance.length > 0) {
        const nextInstance = event.instance[0];
        const startDate = new Date(parseInt(nextInstance.startTime));
        console.log(`        Next round starts: ${startDate.toLocaleString()}`);
      }
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to fetch GAC events:', error);
  }

  // Test 3: Get player data
  const testAllyCode = '456438247'; // From your players.json
  console.log(`3. Fetching player data for ally code ${testAllyCode}...`);
  try {
    const player = await client.getPlayer(testAllyCode);
    console.log(`   ✅ Player found: ${player.name}`);
    console.log(`      Level: ${player.level}`);
    console.log(`      Guild: ${player.guildName || 'N/A'}`);
    console.log(`      Roster size: ${player.rosterUnit?.length || 0} units`);
    
    // Count GLs (Galactic Legends have specific base IDs)
    const glBaseIds = [
      'GLREY', 'SUPREMELEADERKYLOREN', 'SABORLEIA', 'JEDIMASTERKENOBI',
      'LORDVADER', 'GRANDMASTERLUKE', 'JABBATHEHUTT', 'GRANDMASTERPEPES',
      'CAPITALEXECUTOR', 'PROFUNDITY', 'CAPITALLEVIATHAN',
    ];
    const gls = player.rosterUnit?.filter((u) => 
      glBaseIds.some((gl) => u.definitionId.startsWith(gl))
    ).length || 0;
    console.log(`      GLs: ${gls}`);
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to fetch player data:', error);
  }

  // Test 4: Get player arena profile
  console.log(`4. Fetching arena profile for ${testAllyCode}...`);
  try {
    const arenaProfile = await client.getPlayerArena(testAllyCode);
    console.log(`   ✅ Arena profiles found: ${arenaProfile.pvpProfile?.length || 0}`);
    for (const profile of arenaProfile.pvpProfile || []) {
      const tabName = profile.tab === 1 ? 'Squad Arena' : profile.tab === 2 ? 'Fleet Arena' : `Tab ${profile.tab}`;
      console.log(`      - ${tabName}: Rank ${profile.rank}`);
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to fetch arena profile:', error);
  }

  // Test 5: Get GAC leaderboard sample
  console.log('5. Fetching Kyber 1 GAC leaderboard (top 5)...');
  try {
    const leaderboard = await client.getGacLeaderboard(GacLeague.KYBER, GacDivision.DIVISION_1);
    const players = leaderboard.leaderboard?.[0]?.player || [];
    console.log(`   ✅ Leaderboard retrieved, ${players.length} players`);
    const top5 = players.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      const p = top5[i];
      const skillRating = p.playerRating?.playerSkillRating?.skillRating || 0;
      const guildName = p.guild?.name || 'No Guild';
      console.log(`      ${i + 1}. ${p.name} - Skill: ${skillRating} - GP: ${(p.power / 1_000_000).toFixed(1)}M - Guild: ${guildName}`);
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to fetch GAC leaderboard:', error);
  }

  console.log('✅ Comlink integration tests complete!');
  console.log('\n📋 Summary:');
  console.log('   Comlink provides real-time access to:');
  console.log('   - Player rosters and mods');
  console.log('   - GAC events and schedules');
  console.log('   - GAC leaderboards by league/division');
  console.log('   - Guild data');
  console.log('   - Arena profiles');
  console.log('\n   This data comes directly from CG servers, not swgoh.gg!');
}

testComlink().catch(console.error);

