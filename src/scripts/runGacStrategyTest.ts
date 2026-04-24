/**
 * Dry-run /gac strategy (explicit opponent) without Discord.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=/opt/discord-bot/app/.env npx ts-node -r dotenv/config src/scripts/runGacStrategyTest.ts <yourAlly> <oppAlly> [5v5|3v3]
 *
 * Writes PNGs to /tmp/gac-strategy-test-* and prints summary to stdout.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SwgohGgApiClient } from '../integrations/swgohGgApi';
import { CombinedApiClient } from '../integrations/comlink';
import { GacService } from '../services/gacService';
import { GacStrategyService } from '../services/gacStrategyService';
import { logger } from '../utils/logger';
import { getMaxSquadsForLeague, FALLBACK_SEASON_IDS } from '../config/gacConstants';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const yourAllyCode = argv[0]?.replace(/\D/g, '') || '';
  const opponentAllyCode = argv[1]?.replace(/\D/g, '') || '';
  const format = argv[2] === '3v3' ? '3v3' : '5v5';
  const strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced';

  if (yourAllyCode.length !== 9 || opponentAllyCode.length !== 9) {
    console.error('Usage: ts-node src/scripts/runGacStrategyTest.ts <your9digit> <opponent9digit> [5v5|3v3]');
    process.exit(1);
  }

  const swgohGgApiClient = new SwgohGgApiClient();
  const combinedClient = new CombinedApiClient(swgohGgApiClient, {
    preferComlink: true,
    fallbackToSwgohGg: true,
  });
  const gacService = new GacService(combinedClient);
  const gacStrategyService = new GacStrategyService({
    historyClient: swgohGgApiClient,
    counterClient: swgohGgApiClient,
    defenseClient: swgohGgApiClient,
    playerClient: swgohGgApiClient,
  });

  const status = async (s: string): Promise<void> => {
    logger.info(`[dry-run] ${s}`);
  };

  const targetAllyCode = opponentAllyCode;
  let targetName: string | null = null;
  const opponentLeague: string | null = null;

  try {
  try {
    const opponentPlayerData = await swgohGgApiClient.getFullPlayer(targetAllyCode);
    targetName = opponentPlayerData.data.name;
  } catch (e) {
    logger.warn(`Could not fetch opponent name for ${targetAllyCode}:`, e);
  }

  await status('Scraping opponent GAC defense history…');
  const squads = await gacStrategyService.getOpponentDefensiveSquads(targetAllyCode, opponentLeague, format);

  if (squads.length === 0) {
    logger.error('No recent defensive squads found for opponent — same as Discord empty state.');
    process.exit(2);
  }
  logger.info(`Opponent defense squads (deduped by leader): ${squads.length}`);

  await status('Loading your roster…');
  const userRoster = await swgohGgApiClient.getFullPlayer(yourAllyCode);
  logger.info(`Your roster units: ${userRoster.units?.length ?? 0}`);

  let seasonId: string | undefined;
  let bracketFormat: string | undefined;
  try {
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
    const bracketSeasonId = bracketData.season_id;
    const seasonMatch = bracketSeasonId.match(/SEASON_(\d+)/);
    if (seasonMatch) {
      const seasonNumber = parseInt(seasonMatch[1], 10);
      const isBracket3v3 = seasonNumber % 2 === 1;
      bracketFormat = isBracket3v3 ? '3v3' : '5v5';
      let targetSeason: number;
      if (format === '3v3') {
        targetSeason = isBracket3v3 ? seasonNumber - 2 : seasonNumber - 1;
      } else {
        targetSeason = !isBracket3v3 ? seasonNumber - 2 : seasonNumber - 1;
      }
      if (targetSeason < 1) {
        targetSeason = format === '3v3' ? 1 : 2;
      }
      seasonId = `CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_${targetSeason}`;
      logger.info(
        `Season for counters: ${seasonId} (bracket ${seasonNumber}, ${bracketFormat})`
      );
    } else {
      seasonId = bracketSeasonId;
    }
  } catch {
    logger.warn('Could not get bracket season ID');
  }
  if (!seasonId) {
    seasonId = FALLBACK_SEASON_IDS[format];
    logger.warn(`Using fallback season: ${seasonId}`);
  }

  let league: string | null = null;
  let maxDefenseSquads = getMaxSquadsForLeague(null, format);
  try {
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
    league = bracketData.league;
    maxDefenseSquads = getMaxSquadsForLeague(league, format);
    logger.info(`League: ${league}, max defense squads: ${maxDefenseSquads}`);
  } catch (e) {
    logger.warn('Could not get bracket league:', e);
  }

  await status('Evaluating defense candidates…');
  const defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
    userRoster,
    seasonId,
    format,
    strategyPreference
  );
  logger.info(`Defense candidates: ${defenseCandidates.length}`);

  await status('Matching offense counters (Puppeteer / swgoh.gg)…');
  const matchedCounters = await gacStrategyService.matchCountersAgainstRoster(
    squads,
    userRoster,
    seasonId,
    format,
    strategyPreference
  );
  logger.info(`Matched counter rows: ${matchedCounters.length}`);

  const offenseSquads = matchedCounters.filter((m) => m.offense.leader.baseId).map((m) => m.offense);
  const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);

  await status('Suggesting your defense squads…');
  const defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
    userRoster,
    defenseSuggestionsRequested,
    seasonId,
    format,
    offenseSquads,
    defenseCandidates,
    strategyPreference
  );
  logger.info(`Defense suggestions: ${defenseSuggestions.length}`);

  await status('Balancing offense vs defense…');
  const { balancedOffense, balancedDefense } = await gacStrategyService.balanceOffenseAndDefense(
    matchedCounters,
    defenseSuggestions,
    maxDefenseSquads,
    seasonId,
    strategyPreference,
    userRoster,
    format
  );

  const offenseCount = balancedOffense.filter((m) => m.offense.leader.baseId).length;
  const defenseCount = balancedDefense.length;
  logger.info(`Balanced: ${offenseCount} offense, ${defenseCount} defense`);

  await status('Rendering strategy PNGs…');
  const opponentName = targetName || targetAllyCode;
  const { defenseImage, offenseImage } = await gacStrategyService.generateSplitStrategyImages(
    opponentName,
    balancedOffense,
    balancedDefense,
    format,
    maxDefenseSquads,
    userRoster,
    strategyPreference,
    targetAllyCode
  );

  const stamp = Date.now();
  const defPath = path.join('/tmp', `gac-strategy-test-defense-${stamp}.png`);
  const offPath = path.join('/tmp', `gac-strategy-test-offense-${stamp}.png`);
  await fs.promises.writeFile(defPath, defenseImage);
  await fs.promises.writeFile(offPath, offenseImage);

  logger.info(`OK — wrote:\n  ${defPath}\n  ${offPath}`);
  console.log(JSON.stringify({ yourAllyCode, opponentAllyCode, format, opponentName, squads: squads.length, offenseCount, defenseCount, defPath, offPath }, null, 2));
  } finally {
    await gacStrategyService.closeBrowser().catch(() => undefined);
    await swgohGgApiClient.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
