/* eslint-disable no-console */
import * as fs from 'fs';
import { ComlinkClient } from '../src/integrations/comlink/comlinkClient';

async function main(): Promise<void> {
  const allyCode = process.argv[2];
  if (!allyCode) {
    console.error('Usage: ts-node scripts/probeGuildFull.ts <ally-code>');
    process.exit(1);
  }

  const client = new ComlinkClient();
  const player = await client.getPlayer(allyCode);
  if (!player.guildId) { console.error('Player has no guild.'); process.exit(1); }

  const guild = await client.getGuild(player.guildId, true);
  fs.writeFileSync('/tmp/guild-full.json', JSON.stringify(guild, null, 2));
  console.log(`Wrote /tmp/guild-full.json (${JSON.stringify(guild).length} bytes)`);

  const search = await client.searchGuilds(player.guildName ?? 'Future of the Order', 0, 5);
  fs.writeFileSync('/tmp/search-full.json', JSON.stringify(search, null, 2));
  console.log(`Wrote /tmp/search-full.json (${JSON.stringify(search).length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
