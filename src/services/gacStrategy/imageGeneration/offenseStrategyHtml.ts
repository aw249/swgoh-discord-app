/**
 * HTML generation for offense strategy view (standalone offense image).
 * Shows offense counters vs opponent defense squads.
 * Uses GL-style layout from player comparison for consistency.
 */
import { MatchedCounterSquad, UniqueDefensiveSquad, UniqueDefensiveSquadUnit } from '../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';
import { logger } from '../../../utils/logger';
import { buildCharacterStatsMap } from '../utils/rosterUtils';
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON } from '../../../config/imageConstants';
import { AssignedCron, renderCronCell, renderEmptyCronCell } from '../../datacronAllocator';

/** Squad-key conventions for offense rows (used by /gac strategy datacron allocator).
 *  `idx` is the absolute battle index across all chunks (caller passes idx + startBattleIndex). */
export function offenseSquadKey(idx: number): string {
  return `off-${idx}`;
}
export function opponentDefenseKey(idx: number): string {
  return `opp-def-${idx}`;
}

export function generateOffenseStrategyHtml(
  opponentName: string,
  offenseSquads: MatchedCounterSquad[],
  format: string = '5v5',
  maxSquads: number = 11,
  userRoster?: SwgohGgFullPlayerResponse,
  opponentRoster?: SwgohGgFullPlayerResponse,
  unusedGLs?: string[],
  startBattleIndex: number = 0,
  chunkInfo?: { current: number; total: number },
  uncounteredDefenses?: MatchedCounterSquad[],
  assignedCrons?: Map<string, AssignedCron | null>,
  opponentCronsByDefenseKey?: Map<string, AssignedCron | null>
): string {
  logger.info(`[Offense Image] Starting HTML generation vs ${opponentName} (${format} format)`);
  logger.info(`[Offense Image] Input data: ${offenseSquads.length} offense squad(s)`);

  const expectedSquadSize = format === '3v3' ? 3 : 5;
  const visibleOffense = offenseSquads.slice(0, maxSquads);

  // Create character stats AND level mapping from FULL user roster (not just top 80)
  const characterStatsMap = buildCharacterStatsMap(userRoster!);
  if (userRoster) {
    logger.info(`[Offense Image] Built stats map for ${characterStatsMap.size} characters from user roster`);
  }

  // Create character stats mapping from opponent roster for defense squads
  const opponentStatsMap = buildCharacterStatsMap(opponentRoster!);
  if (opponentRoster) {
    logger.info(`[Offense Image] Built stats map for ${opponentStatsMap.size} characters from opponent roster`);
  }

  // Log each offense squad for debugging
  visibleOffense.forEach((match, idx) => {
    const offLeaderBaseId = match.offense.leader.baseId;
    const offLeaderRelic = match.offense.leader.relicLevel;
    const offMemberIds = match.offense.members.map(m => `${m.baseId}(R${m.relicLevel ?? '?'})`).join(', ');
    const defLeaderBaseId = match.defense.leader.baseId;
    logger.info(`[Offense Image] Battle ${idx + 1}: Offense=${offLeaderBaseId}(R${offLeaderRelic ?? '?'}) [${offMemberIds}] vs Defense=${defLeaderBaseId}`);
  });

  const getCharacterStats = (baseId: string, isOffense: boolean): { speed: number; health: number; protection: number; relic: number | null; gearLevel: number; levelLabel: string } | null => {
    if (isOffense) {
      return characterStatsMap.get(baseId) || null;
    } else {
      return opponentStatsMap.get(baseId) || null;
    }
  };

  const renderUnit = (unit: UniqueDefensiveSquadUnit | null, isOffense: boolean): string => {
    if (!unit || !unit.baseId) {
      return `
        <div class="character-cell">
          <div class="character-portrait empty ${isOffense ? 'offense' : 'defense'}">
            <div class="character-placeholder"></div>
          </div>
          <div class="character-stats">
            <div class="stat-row"><span class="stat-label"><img src="${SPEED_ICON}" class="stat-icon" alt="Speed">Spd</span><span class="stat-value">-</span></div>
            <div class="stat-row"><span class="stat-label"><img src="${HEALTH_ICON}" class="stat-icon" alt="Health">HP</span><span class="stat-value">-</span></div>
            <div class="stat-row"><span class="stat-label"><img src="${PROTECTION_ICON}" class="stat-icon" alt="Prot">Prt</span><span class="stat-value">-</span></div>
          </div>
        </div>
      `;
    }

    // Get stats from appropriate roster (user for offense, opponent for defense)
    const stats = getCharacterStats(unit.baseId, isOffense);
    
    // Use unit's relic level if available, otherwise fall back to roster data
    // levelLabel shows "R8" for relics or "G12" for gear
    let levelLabel = '?';
    if (stats?.levelLabel) {
      levelLabel = stats.levelLabel;
    } else if (typeof unit.relicLevel === 'number') {
      levelLabel = `R${Math.max(0, Math.min(10, unit.relicLevel))}`;
    } else if (stats?.relic !== null && stats?.relic !== undefined) {
      levelLabel = `R${stats.relic}`;
    } else if (stats?.gearLevel !== undefined && stats.gearLevel < 13) {
      levelLabel = `G${stats.gearLevel}`;
    }
    
    const portraitUrl = unit.portraitUrl || getCharacterPortraitUrl(unit.baseId);
    const speedValue = stats ? stats.speed.toLocaleString() : '-';
    const healthValue = stats ? stats.health.toFixed(1) + 'K' : '-';
    const protValue = stats ? stats.protection.toFixed(1) + 'K' : '-';
    const isGL = isGalacticLegend(unit.baseId);

    // Show full stats for both offense and defense characters
    const statsHtml = `
      <div class="character-stats${isOffense ? '' : ' defense-stats'}">
        <div class="stat-row"><span class="stat-label">Level</span><span class="stat-value relic-value">${levelLabel}</span></div>
        <div class="stat-row"><span class="stat-label"><img src="${SPEED_ICON}" class="stat-icon" alt="Speed">Spd</span><span class="stat-value">${speedValue}</span></div>
        <div class="stat-row"><span class="stat-label"><img src="${HEALTH_ICON}" class="stat-icon" alt="Health">HP</span><span class="stat-value">${healthValue}</span></div>
        <div class="stat-row"><span class="stat-label"><img src="${PROTECTION_ICON}" class="stat-icon" alt="Prot">Prt</span><span class="stat-value">${protValue}</span></div>
      </div>
    `;

    return `
      <div class="character-cell${isGL ? ' gl' : ''}">
        <div class="character-portrait ${isOffense ? 'offense' : 'defense'}${isGL ? ' gl' : ''}">
          <img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none';" />
        </div>
        ${statsHtml}
      </div>
    `;
  };

  const renderSquad = (squad: UniqueDefensiveSquad, isOffense: boolean): string => {
    const allUnits = [squad.leader, ...squad.members];
    const paddedUnits = [...allUnits];
    while (paddedUnits.length < expectedSquadSize) {
      paddedUnits.push({ baseId: '', gearLevel: null, relicLevel: null, portraitUrl: null });
    }

    return paddedUnits.map(u => renderUnit(u, isOffense)).join('');
  };

  const renderBattleRow = (match: MatchedCounterSquad, index: number): string => {
    const winRate = match.adjustedWinPercentage ?? match.winPercentage;
    const rawWinRate = match.winPercentage;
    const winRateText = winRate !== null ? `${winRate.toFixed(0)}%` : 'N/A';
    const seenCount = match.seenCount;
    const seenText = seenCount !== null ? seenCount.toLocaleString() : 'N/A';
    
    // Determine confidence level based on seen count
    let confidenceLevel = 'Low';
    let confidenceColor = '#ef5350';
    if (seenCount !== null) {
      if (seenCount >= 1000) {
        confidenceLevel = 'High';
        confidenceColor = '#7cb342';
      } else if (seenCount >= 100) {
        confidenceLevel = 'Medium';
        confidenceColor = '#fbbf24';
      }
    }

    // Win rate coloring
    const winRateColor = winRate !== null
      ? (winRate >= 90 ? '#7cb342' : winRate >= 70 ? '#86efac' : winRate >= 50 ? '#fbbf24' : '#ef5350')
      : '#8b7355';

    // Build detailed relic analysis
    let relicAnalysisHtml = '';
    let overallAssessment = '';
    let assessmentColor = '#8b7355';
    let assessmentIcon = '⚖️';

    if (match.keyMatchups) {
      const km = match.keyMatchups;
      const teamDelta = km.teamAverage.delta;
      const leaderDelta = km.leaderVsLeader.delta;
      const highestDelta = km.highestOffenseVsHighestDefense.delta;
      
      // Format delta with sign
      const fmtDelta = (d: number) => d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
      
      // Leader vs Leader comparison
      const leaderColor = leaderDelta >= 1 ? '#7cb342' : leaderDelta >= 0 ? '#fbbf24' : '#ef5350';
      
      // Team average comparison
      const teamColor = teamDelta >= 1 ? '#7cb342' : teamDelta >= 0 ? '#fbbf24' : '#ef5350';
      
      // Damage modifiers
      const damageBoost = ((km.teamAverage.attackerDamageMultiplier - 1) * 100);
      const damageReduction = ((1 - km.teamAverage.defenderDamageMultiplier) * 100);
      
      // Overall assessment
      if (teamDelta >= 3) {
        overallAssessment = 'Dominant Advantage';
        assessmentColor = '#7cb342';
        assessmentIcon = '🔥';
      } else if (teamDelta >= 1) {
        overallAssessment = 'Favourable Matchup';
        assessmentColor = '#86efac';
        assessmentIcon = '✅';
      } else if (teamDelta >= 0) {
        overallAssessment = 'Even Matchup';
        assessmentColor = '#fbbf24';
        assessmentIcon = '⚖️';
      } else if (teamDelta >= -2) {
        overallAssessment = 'Challenging Matchup';
        assessmentColor = '#fbbf24';
        assessmentIcon = '⚠️';
      } else {
        overallAssessment = 'High Risk';
        assessmentColor = '#ef5350';
        assessmentIcon = '❌';
      }

      relicAnalysisHtml = `
        <div class="analysis-grid">
          <div class="analysis-item">
            <span class="analysis-label">Leader vs Leader</span>
            <span class="analysis-value" style="color: ${leaderColor};">${fmtDelta(leaderDelta)} relics</span>
          </div>
          <div class="analysis-item">
            <span class="analysis-label">Team Average</span>
            <span class="analysis-value" style="color: ${teamColor};">${fmtDelta(teamDelta)} relics</span>
          </div>
          <div class="analysis-item">
            <span class="analysis-label">Your Damage</span>
            <span class="analysis-value" style="color: ${damageBoost >= 5 ? '#7cb342' : damageBoost > 0 ? '#86efac' : '#f5deb3'};">${damageBoost >= 0 ? '+' : ''}${damageBoost.toFixed(0)}%</span>
          </div>
          <div class="analysis-item">
            <span class="analysis-label">Enemy Damage</span>
            <span class="analysis-value" style="color: ${damageReduction >= 5 ? '#7cb342' : damageReduction > 0 ? '#86efac' : '#f5deb3'};">${damageReduction >= 0 ? '-' : '+'}${Math.abs(damageReduction).toFixed(0)}%</span>
          </div>
        </div>
      `;
    }
    
    // Build archetype warning if needed
    let archetypeWarningHtml = '';
    if (match.archetypeValidation) {
      const archVal = match.archetypeValidation;
      if (!archVal.viable) {
        // Missing required abilities - show critical warning
        // Extract ability IDs and format them nicely
        const missingAbilities = archVal.missingRequired?.slice(0, 2).map(m => {
          // Use shortDescription if provided, otherwise fall back to unitBaseId
          const reason = m.reason || m.unitBaseId.replace(/_/g, ' ');
          const shortReason = m.shortDescription || reason.split(' - ')[0].split(' massively')[0].split(' provides')[0];
          return shortReason;
        }) || ['abilities'];
        const missingText = missingAbilities.join(', ');
        archetypeWarningHtml = `
          <div class="archetype-warning critical">
            <span style="font-size: 14px;">⚠️</span>
            <span>Missing: ${missingText}</span>
          </div>
        `;
      } else if (archVal.confidence < 0.9 && archVal.missingOptional && archVal.missingOptional.length > 0) {
        // Missing optional abilities - show info warning
        archetypeWarningHtml = `
          <div class="archetype-warning info">
            <span style="font-size: 12px;">ℹ️</span>
            <span>Missing optional zetas</span>
          </div>
        `;
      } else if (archVal.warnings && archVal.warnings.length > 0 && archVal.warnings[0] !== 'No archetype defined - zeta/omicron requirements not validated') {
        // Other warnings
        archetypeWarningHtml = `
          <div class="archetype-warning info">
            <span style="font-size: 12px;">ℹ️</span>
            <span>${archVal.warnings[0]}</span>
          </div>
        `;
      }
    }

    const datacronBadge = match.datacronWarning
      ? `<span class="battle-datacron-warning">⚠ ${match.datacronWarning}</span>`
      : '';

    const battleAbsIndex = index + startBattleIndex;
    const yourCronHtml = (() => {
      if (!assignedCrons) return '';
      const a = assignedCrons.get(offenseSquadKey(battleAbsIndex));
      if (a === undefined) return '';
      return a ? renderCronCell(a, 'friendly') : renderEmptyCronCell();
    })();
    const oppCronHtml = (() => {
      if (!opponentCronsByDefenseKey) return '';
      const a = opponentCronsByDefenseKey.get(opponentDefenseKey(battleAbsIndex));
      if (a === undefined) return '';
      return a ? renderCronCell(a, 'opponent') : renderEmptyCronCell();
    })();

    return `
      <div class="battle-row">
        <div class="battle-header">
          <div class="battle-title">
            <span class="battle-number">Battle ${index + 1 + startBattleIndex}</span>
            <span class="battle-assessment" style="background: ${assessmentColor};">${assessmentIcon} ${overallAssessment}</span>
            ${datacronBadge}
          </div>
        </div>
        <div class="battle-main">
          <div class="battle-content">
            <div class="squad-section offense-section">
              <div class="section-label offense-label">YOUR OFFENSE</div>
              <div class="squad-characters">
                ${renderSquad(match.offense, true)}
                ${yourCronHtml}
              </div>
            </div>
            <div class="vs-divider">VS</div>
            <div class="squad-section defense-section">
              <div class="section-label defense-label">OPPONENT DEFENSE</div>
              <div class="squad-characters">
                ${renderSquad(match.defense, false)}
                ${oppCronHtml}
              </div>
            </div>
          </div>
          <div class="battle-analysis">
            <div class="analysis-header">BATTLE ANALYSIS</div>
            <div class="analysis-stats">
              <div class="stat-box win-box" style="border-color: ${winRateColor};">
                <div class="stat-box-label">Win Rate</div>
                <div class="stat-box-value" style="color: ${winRateColor};">${winRateText}</div>
                ${rawWinRate !== winRate && rawWinRate !== null ? `<div class="stat-box-note">Base: ${rawWinRate.toFixed(0)}%</div>` : ''}
              </div>
              <div class="stat-box seen-box">
                <div class="stat-box-label">Data Points</div>
                <div class="stat-box-value">${seenText}</div>
                <div class="stat-box-note" style="color: ${confidenceColor};">${confidenceLevel} Confidence</div>
              </div>
            </div>
            ${relicAnalysisHtml}
            ${archetypeWarningHtml}
          </div>
        </div>
      </div>
    `;
  };

  const battleRows = visibleOffense.map((match, idx) => renderBattleRow(match, idx)).join('');

  // Render unused GLs section if there are any
  const renderUnusedGLsSection = (): string => {
    if (!unusedGLs || unusedGLs.length === 0) {
      return '';
    }

    const glCards = unusedGLs.map(glBaseId => {
      const portraitUrl = getCharacterPortraitUrl(glBaseId);
      const stats = characterStatsMap.get(glBaseId);
      // Use levelLabel if available, fall back to relic display
      const levelLabel = stats?.levelLabel ?? (stats?.relic !== null && stats?.relic !== undefined ? `R${stats.relic}` : '?');
      
      return `
        <div class="unused-gl-card">
          <div class="unused-gl-portrait">
            <img src="${portraitUrl}" alt="${glBaseId}" onerror="this.style.display='none';" />
          </div>
          <div class="unused-gl-info">
            <div class="unused-gl-name">${glBaseId.replace(/_/g, ' ')}</div>
            <div class="unused-gl-relic">${levelLabel}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="unused-gls-section">
        <div class="unused-gls-header">
          ⚠️ UNUSED GALACTIC LEGENDS
          <span class="unused-gls-note">These GLs were not assigned to any counter - consider manual placement</span>
        </div>
        <div class="unused-gls-container">
          ${glCards}
        </div>
      </div>
    `;
  };

  const unusedGLsSection = renderUnusedGLsSection();

  // Render uncountered-defenses section: opponent squads with no available counter.
  // Shows the user what they're up against so they can plan a manual counter.
  // Each entry mirrors the opponent's squad portrait layout (leader + members).
  const renderUncounteredSection = (): string => {
    if (!uncounteredDefenses || uncounteredDefenses.length === 0) return '';

    const cards = uncounteredDefenses.map(match => {
      const oppLeader = match.defense.leader;
      const oppMembers = match.defense.members ?? [];
      const leaderPortrait = getCharacterPortraitUrl(oppLeader.baseId);

      const memberPortraitsHtml = oppMembers.map(m => {
        const url = getCharacterPortraitUrl(m.baseId);
        return `
          <div class="uncountered-member-portrait">
            <img src="${url}" alt="${m.baseId}" onerror="this.style.display='none';" />
          </div>
        `;
      }).join('');

      return `
        <div class="uncountered-card">
          <div class="uncountered-leader">
            <div class="uncountered-leader-portrait">
              <img src="${leaderPortrait}" alt="${oppLeader.baseId}" onerror="this.style.display='none';" />
            </div>
            <div class="uncountered-leader-name">${oppLeader.baseId.replace(/_/g, ' ')}</div>
          </div>
          <div class="uncountered-members">
            ${memberPortraitsHtml}
          </div>
          <div class="uncountered-banner">✗ Manual counter required</div>
        </div>
      `;
    }).join('');

    return `
      <div class="uncountered-section">
        <div class="uncountered-header">
          ⚠️ UNCOUNTERED DEFENCES (${uncounteredDefenses.length})
          <span class="uncountered-note">No automatic counter found in your roster — pick manually</span>
        </div>
        <div class="uncountered-container">
          ${cards}
        </div>
      </div>
    `;
  };
  const uncounteredSection = renderUncounteredSection();

  // Calculate width based on format (wider to accommodate analysis panel)
  const containerWidth = format === '3v3' ? 1050 : 1600;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Offense Strategy</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #1a1a1a;
      font-family: Arial, sans-serif;
      padding: 20px;
      color: #1a1a1a;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .container {
      width: ${containerWidth}px;
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 16px 20px;
      text-align: center;
      color: #f5deb3;
      font-size: 22px;
      font-weight: bold;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
      border-bottom: 2px solid #c4a35a;
    }
    .header-subtitle {
      font-size: 14px;
      color: #c4a35a;
      margin-top: 4px;
      font-weight: normal;
    }
    .battle-row {
      background: #d4b56a;
      border-bottom: 2px solid #8b7355;
      padding: 12px 16px;
    }
    .battle-row:nth-child(even) {
      background: #b8935a;
    }
    .battle-row:last-child {
      border-bottom: none;
    }
    .battle-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #8b7355;
    }
    .battle-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .battle-number {
      font-size: 18px;
      font-weight: bold;
      color: #1a1a1a;
    }
    .battle-assessment {
      font-size: 12px;
      font-weight: bold;
      color: #1a1a1a;
      padding: 4px 10px;
      border-radius: 12px;
    }
    .battle-main {
      display: flex;
      gap: 16px;
    }
    .battle-content {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
    }
    .battle-analysis {
      width: 200px;
      flex-shrink: 0;
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      overflow: hidden;
    }
    .analysis-header {
      background: #c4a35a;
      color: #1a1a1a;
      font-size: 11px;
      font-weight: bold;
      text-align: center;
      padding: 6px;
    }
    .analysis-stats {
      display: flex;
      gap: 1px;
      background: #8b7355;
    }
    .stat-box {
      flex: 1;
      background: #1a1a1a;
      padding: 8px 6px;
      text-align: center;
      border-left: 3px solid transparent;
    }
    .stat-box-label {
      font-size: 9px;
      color: #8b7355;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .stat-box-value {
      font-size: 18px;
      font-weight: bold;
      color: #f5deb3;
    }
    .stat-box-note {
      font-size: 9px;
      color: #8b7355;
      margin-top: 2px;
    }
    .analysis-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      background: #8b7355;
    }
    .analysis-item {
      background: #1a1a1a;
      padding: 6px;
      text-align: center;
    }
    .analysis-label {
      display: block;
      font-size: 8px;
      color: #8b7355;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .analysis-value {
      font-size: 12px;
      font-weight: bold;
      color: #f5deb3;
    }
    .archetype-warning {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-top: 8px;
    }
    .archetype-warning.critical {
      background: rgba(248, 113, 113, 0.3);
      border: 1px solid #f87171;
      color: #fecaca;
    }
    .archetype-warning.info {
      background: rgba(251, 191, 36, 0.2);
      border: 1px solid #fbbf24;
      color: #fef3c7;
    }
    .squad-section {
      flex: 1;
    }
    .section-label {
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      padding: 4px 8px;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .offense-label {
      background: #4ade80;
      color: #1a1a1a;
    }
    .defense-label {
      background: #c4a35a;
      color: #1a1a1a;
    }
    .vs-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
      color: #1a1a1a;
      padding: 0 8px;
      margin-top: 24px;
    }
    .squad-characters {
      display: flex;
      gap: 6px;
      justify-content: center;
      align-items: center;
    }
    /* Datacron cell — appended to squad-characters by /gac strategy datacron allocator */
    .cron-cell { display:flex; flex-direction:column; align-items:center; width:100px;
      padding:4px; border:2px solid transparent; border-radius:4px; background:rgba(0,0,0,0.18);
      margin-left:8px; }
    .cron-cell--friendly { border-color:#c4a35a; }
    .cron-cell--opponent { border-color:#b13c3c; }
    /* Empty cell: occupies the cron column's reserved width so rows stay
       aligned, but renders nothing visible — no border, no background, no
       inner content. The cell is purely a layout spacer. */
    .cron-cell--empty { visibility:hidden; border-color:transparent; background:transparent; }
    .cron-cell__art { position:relative; width:80px; height:80px; }
    .cron-cell__box { width:100%; height:100%; object-fit:contain; }
    .cron-cell__callout { position:absolute; bottom:-6px; right:-6px; width:36px; height:36px;
      border-radius:50%; border:2px solid #1a1a1a; }
    .cron-cell__name { font-size:11px; font-weight:600; margin-top:6px; text-align:center;
      max-width:96px; word-break:break-word; }
    .cron-cell__dots { display:flex; gap:4px; margin-top:4px; }
    .cron-cell__dot { width:6px; height:6px; border-radius:50%; background:#444; }
    .cron-cell__dot--lit { background:#c4a35a; }
    /* Vertical stack: details wrapper is layout-transparent so the children
       behave as if they were direct .cron-cell siblings. */
    .cron-cell__details { display:contents; }
    .cron-cell__tiers { width:100%; margin-top:4px; padding-top:4px; border-top:1px solid #2a2a2a;
      display:flex; flex-direction:column; gap:1px; }
    .cron-cell__tier-row { display:flex; gap:4px; font-size:9px; color:#e0e0e0; line-height:1.2; }
    .cron-cell__tier-label { font-weight:700; color:#c4a35a; min-width:18px; }
    .cron-cell__tier-target { flex:1; word-break:break-word; }
    .cron-cell__stats { width:100%; margin-top:4px; padding-top:4px; border-top:1px solid #2a2a2a;
      display:flex; flex-direction:column; gap:1px; }
    .cron-cell__stat-row { display:flex; justify-content:space-between; gap:4px; font-size:9px;
      color:#e0e0e0; line-height:1.2; }
    .cron-cell__stat-name { opacity:0.7; }
    .cron-cell__stat-value { font-weight:600; }
    .character-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: ${format === '3v3' ? 120 : 100}px;
    }
    .character-cell.gl .character-portrait {
      box-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
    }
    .character-portrait {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 3px solid #c4a35a;
      position: relative;
      overflow: hidden;
      background: #4a4a4a;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .character-portrait.offense {
      border-color: #4ade80;
    }
    .character-portrait.offense.gl {
      border-color: #fbbf24;
    }
    .character-portrait.defense {
      border-color: #c4a35a;
    }
    .character-portrait.defense.gl {
      border-color: #fbbf24;
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.empty {
      border-style: dashed;
      border-color: #8b7355;
    }
    .character-placeholder {
      width: 100%;
      height: 100%;
      background: rgba(74, 74, 74, 0.3);
      border-radius: 50%;
    }
    .relic-value {
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000 !important;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .character-stats {
      background: #2a2a2a;
      border: 1px solid #8b7355;
      border-radius: 4px;
      padding: 4px;
      width: 100%;
    }
    .character-stats.defense-stats {
      background: #1a1a1a;
      text-align: center;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 4px;
      background: #1a1a1a;
      border-radius: 2px;
      margin-bottom: 1px;
      font-size: 10px;
    }
    .stat-row.full-width {
      justify-content: center;
      padding: 4px;
    }
    .stat-row:last-child {
      margin-bottom: 0;
    }
    .stat-label {
      color: #8b7355;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .stat-icon {
      width: 12px;
      height: 12px;
    }
    .stat-value {
      color: #f5deb3;
      font-weight: bold;
    }
    .unused-gls-section {
      background: linear-gradient(135deg, #3a2a1a 0%, #2a1a10 100%);
      border-top: 2px solid #c4a35a;
      padding: 16px;
    }
    .unused-gls-header {
      color: #fbbf24;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .unused-gls-note {
      font-size: 11px;
      color: #8b7355;
      font-weight: normal;
    }
    .unused-gls-container {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: center;
    }
    .unused-gl-card {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #2a2a2a;
      border: 2px solid #fbbf24;
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 0 12px rgba(251, 191, 36, 0.3);
    }
    .unused-gl-portrait {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid #fbbf24;
      overflow: hidden;
      background: #4a4a4a;
    }
    .unused-gl-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .unused-gl-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .unused-gl-name {
      color: #fbbf24;
      font-size: 12px;
      font-weight: bold;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .unused-gl-relic {
      color: #f5deb3;
      font-size: 11px;
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: bold;
      text-align: center;
    }
    .uncountered-section {
      background: linear-gradient(135deg, #3a1a1a 0%, #2a1010 100%);
      border-top: 2px solid #ef5350;
      padding: 16px;
    }
    .uncountered-header {
      color: #ef5350;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .uncountered-note {
      font-size: 11px;
      color: #b78282;
      font-weight: normal;
    }
    .uncountered-container {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: center;
    }
    .uncountered-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      background: #2a1818;
      border: 2px solid #ef5350;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 0 12px rgba(239, 83, 80, 0.3);
      min-width: 220px;
    }
    .uncountered-leader {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .uncountered-leader-portrait {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 2px solid #ef5350;
      overflow: hidden;
      background: #4a4a4a;
    }
    .uncountered-leader-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .uncountered-leader-name {
      color: #ef5350;
      font-size: 13px;
      font-weight: bold;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .uncountered-members {
      display: flex;
      gap: 6px;
      justify-content: center;
    }
    .uncountered-member-portrait {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid #8b3838;
      overflow: hidden;
      background: #4a4a4a;
    }
    .uncountered-member-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .uncountered-banner {
      color: #fff;
      background: #ef5350;
      font-size: 11px;
      font-weight: bold;
      padding: 4px 10px;
      border-radius: 4px;
      text-align: center;
    }
    .battle-datacron-warning {
      display: inline-block;
      background: #1f1f1f;
      color: #fbbf24;
      border: 1px solid #fbbf24;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 4px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
      <div class="header">
      ⚔️ OFFENSE STRATEGY vs ${opponentName}${chunkInfo ? ` — Part ${chunkInfo.current}/${chunkInfo.total}` : ''}
      <div class="header-subtitle">${format} • ${visibleOffense.length} Battle${visibleOffense.length !== 1 ? 's' : ''}${chunkInfo ? ` (${startBattleIndex + 1}-${startBattleIndex + visibleOffense.length})` : ''}</div>
    </div>
    ${battleRows}
    ${uncounteredSection}
    ${unusedGLsSection}
  </div>
</body>
</html>`;

  logger.info(`[Offense Image] HTML generation complete: ${visibleOffense.length} battle(s)`);
  return html;
}


