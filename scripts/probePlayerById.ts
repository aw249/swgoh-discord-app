/* eslint-disable no-console */
import { ComlinkClient } from '../src/integrations/comlink/comlinkClient';

async function main(): Promise<void> {
  const playerId = process.argv[2];
  if (!playerId) {
    console.error('Usage: ts-node scripts/probePlayerById.ts <playerId>');
    process.exit(1);
  }

  const client = new ComlinkClient();
  const player = await client.getPlayerById(playerId);
  console.log(JSON.stringify({
    name: player.name,
    level: player.level,
    allyCode: player.allyCode,
    rosterUnitCount: player.rosterUnit?.length,
    sampleUnitDef: player.rosterUnit?.[0]?.definitionId,
    profileStatCount: player.profileStat?.length,
  }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
