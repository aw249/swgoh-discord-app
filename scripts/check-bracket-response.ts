/**
 * Quick check to see what swgoh.gg's bracket API returns
 * and if we can use the event_id with Comlink
 */

// Fetch directly from swgoh.gg API to see the raw response
async function checkBracketResponse(): Promise<void> {
  const allyCode = '456438247';
  const url = `https://swgoh.gg/api/player/${allyCode}/gac-bracket/`;
  
  console.log(`Fetching bracket from: ${url}\n`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('=== Raw swgoh.gg Bracket Response ===');
    console.log('Top-level keys:', Object.keys(data));
    
    if (data.data) {
      console.log('\n=== data object ===');
      const bracket = data.data;
      console.log('  season_id:', bracket.season_id);
      console.log('  season_number:', bracket.season_number);
      console.log('  event_id:', bracket.event_id);
      console.log('  bracket_id:', bracket.bracket_id);
      console.log('  league:', bracket.league);
      console.log('  start_time:', bracket.start_time);
      console.log('  players count:', bracket.bracket_players?.length);
      
      // Check if event_id matches Comlink format
      console.log('\n=== Comlink compatibility ===');
      if (bracket.event_id) {
        const eventInstanceId = `${bracket.season_id}:${bracket.event_id}`;
        console.log('  Constructed eventInstanceId:', eventInstanceId);
        
        // Construct the groupId for Comlink
        const league = bracket.league?.toUpperCase();
        const groupId = `${eventInstanceId}:${league}:${bracket.bracket_id}`;
        console.log('  Constructed groupId:', groupId);
        
        console.log('\n=== This could be used with Comlink! ===');
        console.log('  POST /getLeaderboard');
        console.log('  {');
        console.log('    "payload": {');
        console.log('      "leaderboardType": 4,');
        console.log(`      "eventInstanceId": "${eventInstanceId}",`);
        console.log(`      "groupId": "${groupId}"`);
        console.log('    }');
        console.log('  }');
      }
    }
  } catch (error) {
    console.error('Error:', error);
    console.log('\nNote: This might fail due to Cloudflare protection.');
    console.log('The bot uses Puppeteer to bypass this.');
  }
}

checkBracketResponse();

