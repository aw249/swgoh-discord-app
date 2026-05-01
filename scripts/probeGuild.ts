/* eslint-disable no-console */
import { ComlinkClient } from '../src/integrations/comlink/comlinkClient';

async function main(): Promise<void> {
  const allyCode = process.argv[2];
  if (!allyCode) {
    console.error('Usage: ts-node scripts/probeGuild.ts <ally-code>');
    process.exit(1);
  }

  const client = new ComlinkClient();
  console.log(`Fetching player ${allyCode}...`);
  const player = await client.getPlayer(allyCode);
  if (!player.guildId) {
    console.error('Player has no guild.');
    process.exit(1);
  }

  console.log(`Fetching guild ${player.guildId}...`);
  const guild = await client.getGuild(player.guildId, false);
  console.log('--- guild ---');
  console.log(JSON.stringify(guild, null, 2).slice(0, 12000));

  console.log(`\nSearching guilds by name "${player.guildName ?? 'Test'}"...`);
  const search = await client.searchGuilds(player.guildName ?? 'Test', 0, 5);
  console.log('--- searchGuilds ---');
  console.log(JSON.stringify(search, null, 2).slice(0, 8000));
}

main().catch(err => { console.error(err); process.exit(1); });
