import { GacStrategyService } from './src/services/gacStrategyService';
import { GacService } from './src/services/gacService';
import { SwgohGgApiClient } from './src/integrations/swgohGgApi';
import { logger } from './src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Helper function to check if a character is a GL (since isGalacticLegend is private)
const GALACTIC_LEGEND_IDS = [
  'GLREY',
  'SUPREMELEADERKYLOREN',
  'GRANDMASTERLUKE',
  'SITHPALPATINE',
  'JEDIMASTERKENOBI',
  'LORDVADER',
  'JABBATHEHUTT',
  'GLLEIA',
  'GLAHSOKATANO',
  'GLHONDO'
];

function isGalacticLegend(leaderBaseId: string): boolean {
  return GALACTIC_LEGEND_IDS.includes(leaderBaseId);
}

// Capture all console output
const logFile = path.join(__dirname, 'gac-strategy-diagnostic.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

// Override console methods to write to both console and file
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalDebug = console.debug;

function writeToFile(level: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [${level}] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ')}\n`;
  logStream.write(message);
  // Also write to original console
  if (level === 'INFO') originalLog(...args);
  else if (level === 'WARN') originalWarn(...args);
  else if (level === 'ERROR') originalError(...args);
  else if (level === 'DEBUG') originalDebug(...args);
}

console.log = (...args: unknown[]) => writeToFile('INFO', ...args);
console.warn = (...args: unknown[]) => writeToFile('WARN', ...args);
console.error = (...args: unknown[]) => writeToFile('ERROR', ...args);
console.debug = (...args: unknown[]) => writeToFile('DEBUG', ...args);

async function diagnoseGacStrategy(): Promise<void> {
  try {
    logger.info('=== GAC Strategy Diagnostic Test ===');
    logger.info('Parameters:');
    logger.info('  Your Ally Code: 456438247');
    logger.info('  Opponent Ally Code: 885584618');
    logger.info('  Format: 3v3');
    logger.info('  Strategy: balanced');
    logger.info('');

    // Initialize services
    const swgohGgApiClient = new SwgohGgApiClient();
    const gacService = new GacService(swgohGgApiClient);
    const gacStrategyService = new GacStrategyService(
      swgohGgApiClient,
      swgohGgApiClient,
      swgohGgApiClient
    );

    const yourAllyCode = '456438247';
    const opponentAllyCode = '885584618';
    const format = '3v3';
    const strategyPreference = 'balanced' as const;

    logger.info('Step 1: Fetching your roster...');
    const yourRoster = await swgohGgApiClient.getFullPlayer(yourAllyCode);
    logger.info(`  Fetched roster: ${yourRoster.data.name} (${yourRoster.data.galactic_power.toLocaleString()} GP)`);
    logger.info(`  Total units: ${yourRoster.units?.length || 0}`);
    logger.info('');

    logger.info('Step 2: Fetching opponent roster...');
    const opponentRoster = await swgohGgApiClient.getFullPlayer(opponentAllyCode);
    logger.info(`  Fetched opponent: ${opponentRoster.data.name} (${opponentRoster.data.galactic_power.toLocaleString()} GP)`);
    logger.info(`  Total units: ${opponentRoster.units?.length || 0}`);
    logger.info('');

    logger.info('Step 3: Getting GAC bracket to determine league...');
    const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
    const yourPlayer = bracketData.bracket_players.find(
      p => p.ally_code.toString() === yourAllyCode
    );
    const league = bracketData.league || 'Unknown';
    logger.info(`  League: ${league}`);
    logger.info(`  Your rank: ${yourPlayer?.bracket_rank || 'Unknown'}`);
    logger.info('');

    logger.info('Step 4: Getting opponent defensive squads...');
    const opponentDefensiveSquads = await gacStrategyService.getOpponentDefensiveSquads(
      opponentAllyCode,
      league,
      format
    );
    logger.info(`  Found ${opponentDefensiveSquads.length} defensive squad(s) from opponent history`);
    if (opponentDefensiveSquads.length > 0) {
      logger.info('  Opponent defensive squads (from getOpponentDefensiveSquads):');
      opponentDefensiveSquads.forEach((squad, idx) => {
        const members = squad.members.map(m => m.baseId).join(', ');
        logger.info(`    ${idx + 1}. ${squad.leader.baseId} - Members: ${members}`);
      });
    } else {
      logger.warn('  WARNING: No opponent defensive squads found!');
    }
    logger.info('');

    logger.info('Step 5: Determining max defense squads...');
    const leagueMaxMap: Record<string, { '5v5': number; '3v3': number }> = {
      'Kyber': { '5v5': 11, '3v3': 15 },
      'Aurodium': { '5v5': 9, '3v3': 13 },
      'Chromium': { '5v5': 7, '3v3': 10 },
      'Bronzium': { '5v5': 5, '3v3': 7 },
      'Carbonite': { '5v5': 3, '3v3': 3 }
    };
    const normalizedLeague = league.charAt(0).toUpperCase() + league.slice(1).toLowerCase();
    const leagueData = leagueMaxMap[normalizedLeague];
    const maxDefenseSquads = leagueData 
      ? (leagueData[format as '5v5' | '3v3'] ?? (format === '3v3' ? 15 : 11))
      : (format === '3v3' ? 15 : 11);
    logger.info(`  Max defense squads for ${league} league (${format}): ${maxDefenseSquads}`);
    logger.info('');

    logger.info('Step 6: Determining season ID...');
    // Get season ID similar to how the command does it
    let seasonId: string | undefined;
    try {
      const bracketData = await gacService.getBracketForAllyCode(yourAllyCode);
      const bracketSeasonId = bracketData.season_id;
      const seasonMatch = bracketSeasonId.match(/SEASON_(\d+)/);
      if (seasonMatch) {
        const seasonNumber = parseInt(seasonMatch[1], 10);
        const isBracket3v3 = seasonNumber % 2 === 1;
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
      } else {
        seasonId = bracketSeasonId;
      }
    } catch {
      if (format === '3v3') {
        seasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71';
      }
    }
    logger.info(`  Using season: ${seasonId || 'default'}`);
    logger.info('');

    logger.info('Step 7: Evaluating roster for defense (OFFENSIVE STRATEGY)...');
    
    const defenseCandidates = await gacStrategyService.evaluateRosterForDefense(
      yourRoster,
      seasonId,
      format
    );
    logger.info(`  Found ${defenseCandidates.length} defense candidate(s)`);
    logger.info('');

    logger.info('Step 8: Suggesting defense squads...');
    const defenseSuggestionsRequested = Math.max(Math.ceil(maxDefenseSquads * 2.5), 20);
    logger.info(`  Requesting ${defenseSuggestionsRequested} defense suggestions`);
    
    const defenseSuggestions = await gacStrategyService.suggestDefenseSquads(
      yourRoster,
      defenseSuggestionsRequested,
      seasonId,
      format,
      [], // No offense squads to avoid yet
      defenseCandidates,
      strategyPreference
    );
    logger.info(`  Received ${defenseSuggestions.length} defense suggestion(s)`);
    
    // Log details about defense suggestions
    const glDefenseSquads = defenseSuggestions.filter(s => 
      isGalacticLegend(s.squad.leader.baseId)
    );
    logger.info(`  GL defense squads: ${glDefenseSquads.length}`);
    logger.info(`  Non-GL defense squads: ${defenseSuggestions.length - glDefenseSquads.length}`);
    
    if (defenseSuggestions.length > 0) {
      logger.info('  Top 10 defense suggestions:');
      defenseSuggestions.slice(0, 10).forEach((suggestion, idx) => {
        const isGL = isGalacticLegend(suggestion.squad.leader.baseId);
        logger.info(
          `    ${idx + 1}. ${suggestion.squad.leader.baseId}${isGL ? ' (GL)' : ''} ` +
          `- Hold: ${suggestion.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `Score: ${suggestion.score.toFixed(1)}, ` +
          `Reason: ${suggestion.reason}`
        );
      });
    }
    logger.info('');

    logger.info('Step 9: Matching offense counters against opponent defense...');
    const offenseCounters = await gacStrategyService.matchCountersAgainstRoster(
      opponentDefensiveSquads,
      yourRoster,
      seasonId,
      format,
      strategyPreference
    );
    logger.info(`  Matched ${offenseCounters.length} offense counter(s)`);
    
    const glOffenseCounters = offenseCounters.filter(c => 
      c.offense.leader.baseId && isGalacticLegend(c.offense.leader.baseId)
    );
    logger.info(`  GL offense counters: ${glOffenseCounters.length}`);
    logger.info(`  Non-GL offense counters: ${offenseCounters.length - glOffenseCounters.length}`);
    logger.info('');

    logger.info('Step 10: Balancing offense and defense...');
    const balanced = await gacStrategyService.balanceOffenseAndDefense(
      offenseCounters,
      defenseSuggestions,
      maxDefenseSquads,
      seasonId,
      strategyPreference,
      yourRoster,
      format
    );
    logger.info(`  Final offense squads: ${balanced.balancedOffense.length}`);
    logger.info(`  Final defense squads: ${balanced.balancedDefense.length}`);
    logger.info('');

    logger.info('Step 11: Final Defense Squad Details...');
    if (balanced.balancedDefense.length > 0) {
      balanced.balancedDefense.forEach((defense, idx) => {
        const isGL = isGalacticLegend(defense.squad.leader.baseId);
        logger.info(
          `  Defense ${idx + 1}: ${defense.squad.leader.baseId}${isGL ? ' (GL)' : ''} ` +
          `- Hold: ${defense.holdPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `Members: ${defense.squad.members.map(m => m.baseId).join(', ')}`
        );
      });
    } else {
      logger.warn('  No defense squads were placed!');
    }
    logger.info('');

    logger.info('Step 12: Final Offense Squad Details...');
    if (balanced.balancedOffense.length > 0) {
      balanced.balancedOffense.forEach((offense, idx) => {
        const isGL = offense.offense.leader.baseId && 
          isGalacticLegend(offense.offense.leader.baseId);
        logger.info(
          `  Offense ${idx + 1}: ${offense.offense.leader.baseId}${isGL ? ' (GL)' : ''} ` +
          `vs ${offense.defense.leader.baseId} ` +
          `- Win: ${offense.winPercentage?.toFixed(1) ?? 'N/A'}%, ` +
          `Members: ${offense.offense.members.map(m => m.baseId).join(', ')}`
        );
      });
    } else {
      logger.warn('  No offense squads were placed!');
    }
    logger.info('');

    logger.info('=== Diagnostic Complete ===');
    logger.info(`Log file saved to: ${logFile}`);
    
  } catch (error) {
    logger.error('Error during diagnostic:', error);
    if (error instanceof Error) {
      logger.error('Stack trace:', error.stack);
    }
  } finally {
    logStream.end();
    // Restore original console methods
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  }
}

// Run the diagnostic
diagnoseGacStrategy().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

