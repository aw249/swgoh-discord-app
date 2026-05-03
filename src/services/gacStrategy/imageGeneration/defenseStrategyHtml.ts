/**
 * HTML generation for defense strategy view (standalone defense image).
 * Uses GL-style layout from player comparison for consistency.
 */
import { DefenseSuggestion, UniqueDefensiveSquadUnit } from '../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';
import { logger } from '../../../utils/logger';
import { buildCharacterStatsMap } from '../utils/rosterUtils';
import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON } from '../../../config/imageConstants';
import { AssignedCron, renderCronCell, renderEmptyCronCell } from '../../datacronAllocator';

/** Squad-key convention for defense rows (used by /gac strategy datacron allocator). */
export function defenseSquadKey(idx: number): string {
  return `def-${idx}`;
}

export function generateDefenseStrategyHtml(
  playerName: string,
  defenseSquads: DefenseSuggestion[],
  format: string = '5v5',
  maxSquads: number = 11,
  userRoster?: SwgohGgFullPlayerResponse,
  strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced',
  unusedGLs?: string[],
  assignedCrons?: Map<string, AssignedCron | null>
): string {
  logger.info(`[Defense Image] Starting HTML generation for ${playerName} (${format} format)`);
  logger.info(`[Defense Image] Input data: ${defenseSquads.length} defense squad(s)`);

  const expectedSquadSize = format === '3v3' ? 3 : 5;
  const visibleDefense = defenseSquads.slice(0, maxSquads);

  // Create character stats AND level mapping from FULL user roster (not just top 80)
  const characterStatsMap = buildCharacterStatsMap(userRoster!);
  if (userRoster) {
    logger.info(`[Defense Image] Built stats map for ${characterStatsMap.size} characters from full roster`);
  }

  // Log each defense squad for debugging
  visibleDefense.forEach((def, idx) => {
    const leaderBaseId = def.squad.leader.baseId;
    const leaderRelic = def.squad.leader.relicLevel;
    const memberIds = def.squad.members.map(m => `${m.baseId}(R${m.relicLevel ?? '?'})`).join(', ');
    const leaderStats = characterStatsMap.get(leaderBaseId);
    logger.info(`[Defense Image] Squad ${idx + 1}: Leader=${leaderBaseId}(R${leaderRelic ?? '?'}, stats=${leaderStats ? 'found' : 'MISSING'}), Members=[${memberIds}]`);
  });

  const getCharacterStats = (baseId: string): { speed: number; health: number; protection: number; relic: number | null; gearLevel: number; levelLabel: string } | null => {
    return characterStatsMap.get(baseId) || null;
  };

  const renderUnit = (unit: UniqueDefensiveSquadUnit | null): string => {
    if (!unit || !unit.baseId) {
      return `
        <div class="character-cell">
          <div class="character-portrait empty">
            <div class="character-placeholder"></div>
          </div>
          <div class="character-stats">
            <div class="stat-row"><span class="stat-label"><img src="${SPEED_ICON}" class="stat-icon" alt="Speed">Speed</span><span class="stat-value">-</span></div>
            <div class="stat-row"><span class="stat-label"><img src="${HEALTH_ICON}" class="stat-icon" alt="Health">Health</span><span class="stat-value">-</span></div>
            <div class="stat-row"><span class="stat-label"><img src="${PROTECTION_ICON}" class="stat-icon" alt="Prot">Prot</span><span class="stat-value">-</span></div>
          </div>
        </div>
      `;
    }

    const stats = getCharacterStats(unit.baseId);
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

    return `
      <div class="character-cell${isGL ? ' gl' : ''}">
        <div class="character-portrait${isGL ? ' gl' : ''}">
          <img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none';" />
        </div>
        <div class="character-stats">
          <div class="stat-row"><span class="stat-label">Level</span><span class="stat-value relic-value">${levelLabel}</span></div>
          <div class="stat-row"><span class="stat-label"><img src="${SPEED_ICON}" class="stat-icon" alt="Speed">Speed</span><span class="stat-value">${speedValue}</span></div>
          <div class="stat-row"><span class="stat-label"><img src="${HEALTH_ICON}" class="stat-icon" alt="Health">Health</span><span class="stat-value">${healthValue}</span></div>
          <div class="stat-row"><span class="stat-label"><img src="${PROTECTION_ICON}" class="stat-icon" alt="Prot">Prot</span><span class="stat-value">${protValue}</span></div>
        </div>
      </div>
    `;
  };

  const renderSquadRow = (defense: DefenseSuggestion, index: number): string => {
    const allUnits = [defense.squad.leader, ...defense.squad.members];
    const paddedUnits = [...allUnits];
    while (paddedUnits.length < expectedSquadSize) {
      paddedUnits.push({ baseId: '', gearLevel: null, relicLevel: null, portraitUrl: null });
    }

    const holdPercentage = defense.holdPercentage;
    const seenCount = defense.seenCount;
    const holdText = holdPercentage !== null ? `${holdPercentage.toFixed(0)}%` : 'N/A';
    const seenText = seenCount !== null ? seenCount.toLocaleString() : 'N/A';
    const holdColor = holdPercentage !== null
      ? (holdPercentage >= 50 ? '#7cb342' : holdPercentage >= 30 ? '#fbbf24' : '#ef5350')
      : '#8b7355';

    // Build archetype warning if needed
    let archetypeWarningHtml = '';
    if (defense.archetypeValidation) {
      const archVal = defense.archetypeValidation;
      if (!archVal.viable) {
        // Missing required abilities - show critical warning with descriptive reason
        const missingAbilities = archVal.missingRequired?.slice(0, 2).map(m => {
          // Use the reason field which has descriptive text like "Malicos GAC omicron..."
          // Truncate to keep it readable
          const reason = m.reason || m.unitBaseId.replace(/_/g, ' ');
          // Use shortDescription if provided, otherwise extract short form from reason
          const shortReason = m.shortDescription || reason.split(' - ')[0].split(' massively')[0].split(' provides')[0];
          return shortReason;
        }) || ['abilities'];
        const missingText = missingAbilities.join('; ');
        archetypeWarningHtml = `
          <div class="archetype-warning critical">
            <span style="font-size: 14px;">⚠️</span>
            <span>Missing: ${missingText}</span>
          </div>
        `;
      } else if (archVal.confidence < 0.9 && archVal.missingOptional && archVal.missingOptional.length > 0) {
        // Missing optional abilities - show info warning with specific ability
        const missingOptionalText = archVal.missingOptional.slice(0, 1).map(m => {
          const reason = m.reason || m.unitBaseId.replace(/_/g, ' ');
          // Use shortDescription if provided, otherwise extract short form from reason
          const shortReason = m.shortDescription || reason.split(' - ')[0].split(' massively')[0].split(' provides')[0];
          return shortReason;
        }).join('; ');
        archetypeWarningHtml = `
          <div class="archetype-warning info">
            <span style="font-size: 12px;">ℹ️</span>
            <span>Missing: ${missingOptionalText}</span>
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

    const cronHtml = (() => {
      if (!assignedCrons) return '';
      const a = assignedCrons.get(defenseSquadKey(index));
      if (a === undefined) return '';
      return a ? renderCronCell(a, 'friendly') : renderEmptyCronCell();
    })();

    return `
      <div class="squad-row">
        <div class="squad-header">
          <span class="squad-number">Defense ${index + 1}</span>
          <div class="squad-stats">
            <span class="hold-stat" style="color: ${holdColor};">🛡️ Hold: ${holdText}</span>
            <span class="seen-stat">Seen: ${seenText}</span>
            ${archetypeWarningHtml}
          </div>
        </div>
        <div class="squad-characters">
          ${paddedUnits.map(u => renderUnit(u)).join('')}
          ${cronHtml}
        </div>
      </div>
    `;
  };

  const squadRows = visibleDefense.map((def, idx) => renderSquadRow(def, idx)).join('');
  const strategyLabel = strategyPreference === 'defensive' ? 'DEFENSIVE' : strategyPreference === 'offensive' ? 'OFFENSIVE' : 'BALANCED';

  // Render unused GLs section if there are any
  const renderUnusedGLsSection = (): string => {
    if (!unusedGLs || unusedGLs.length === 0) {
      return '';
    }

    const glCards = unusedGLs.map(glBaseId => {
      const portraitUrl = getCharacterPortraitUrl(glBaseId);
      const stats = characterStatsMap.get(glBaseId);
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
          <span class="unused-gls-note">These GLs were not assigned to offense or defense - consider manual placement</span>
        </div>
        <div class="unused-gls-container">
          ${glCards}
        </div>
      </div>
    `;
  };

  const unusedGLsSection = renderUnusedGLsSection();

  // Calculate width based on format - doubled for 2-column layout
  // Defense uses the same compact character-cell sizing as the offense template
  // (100/120 px wide cells, 56 px portraits) so a squad row + cron cell fits in
  // the original singleSquadWidth budget with no canvas growth.
  const singleSquadWidth = format === '3v3' ? 620 : 920;
  const containerWidth = singleSquadWidth * 2 + 40; // 2 columns + 40px gap

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Defense Strategy</title>
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
    .squads-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 12px;
    }
    .squad-row {
      background: #d4b56a;
      border: 2px solid #8b7355;
      border-radius: 6px;
      padding: 12px 16px;
    }
    .squad-row:nth-child(even) {
      background: #b8935a;
    }
    .squad-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #8b7355;
    }
    .squad-number {
      font-size: 16px;
      font-weight: bold;
      color: #1a1a1a;
    }
    .squad-stats {
      display: flex;
      gap: 16px;
      font-size: 14px;
      font-weight: bold;
    }
    .hold-stat {
      font-weight: bold;
    }
    .seen-stat {
      color: #5a4a3a;
    }
    .squad-characters {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
    }
    /* Datacron cell — appended to squad-characters by /gac strategy datacron allocator */
    .cron-cell { display:flex; flex-direction:column; align-items:center; width:170px;
      padding:4px; border:2px solid transparent; border-radius:4px; background:rgba(0,0,0,0.18);
      margin-left:8px; }
    .cron-cell--friendly { border-color:#c4a35a; }
    .cron-cell--opponent { border-color:#b13c3c; }
    .cron-cell--filler { opacity:0.85; }
    /* Empty cell: invisible but preserves layout width so rows stay aligned. */
    .cron-cell--empty { visibility:hidden; border-color:transparent; background:transparent; }
    .cron-cell__art { position:relative; width:80px; height:80px; }
    .cron-cell__box { width:100%; height:100%; object-fit:contain; }
    .cron-cell__callout { position:absolute; bottom:-6px; right:-6px; width:36px; height:36px;
      border-radius:50%; border:2px solid #1a1a1a; }
    .cron-cell__name { font-size:11px; font-weight:600; margin-top:6px; text-align:center;
      max-width:160px; word-break:break-word; color:#1a1a1a; }
    .cron-cell__dots { display:flex; gap:4px; margin-top:4px; }
    .cron-cell__dot { width:6px; height:6px; border-radius:50%; background:#444; }
    .cron-cell__dot--lit { background:#c4a35a; }
    .cron-cell__filler-note { font-size:10px; opacity:0.7; margin-top:2px; color:#1a1a1a; }
    .cron-cell__placeholder { font-size:11px; color:#888; padding:28px 4px; text-align:center; }
    .cron-cell__details { width:100%; margin-top:6px; padding-top:4px; border-top:1px solid #d8c79a;
      display:flex; flex-direction:row; gap:8px; align-items:flex-start; }
    .cron-cell__tiers { flex:0 0 auto; min-width:60px; display:flex; flex-direction:column; gap:1px; }
    .cron-cell__tier-row { display:flex; gap:3px; font-size:9px; color:#1a1a1a; line-height:1.2; }
    .cron-cell__tier-label { font-weight:700; color:#7a5a1f; min-width:18px; }
    .cron-cell__tier-target { flex:1; word-break:break-word; }
    .cron-cell__stats { flex:1 1 auto; display:flex; flex-direction:column; gap:1px;
      border-left:1px solid #d8c79a; padding-left:6px; }
    .cron-cell__stat-row { display:flex; justify-content:space-between; gap:4px; font-size:9px;
      color:#1a1a1a; line-height:1.2; }
    .cron-cell__stat-name { opacity:0.75; }
    .cron-cell__stat-value { font-weight:600; }
    /* When only one of the two columns is present, stats has no tiers to its
       left — drop the divider so it doesn't render orphaned. */
    .cron-cell__details > .cron-cell__stats:first-child { border-left:none; padding-left:0; }
    /* Character cell + portrait sizing matches offenseStrategyHtml.ts so defense
       and offense images render with consistent visual density and so the cron
       column fits inside singleSquadWidth without canvas growth. */
    .character-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: ${format === '3v3' ? 120 : 100}px;
    }
    .character-cell.gl .character-portrait {
      border-color: #fbbf24;
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
    /* Stat panel sizing matches offenseStrategyHtml.ts for visual consistency. */
    .character-stats {
      background: #2a2a2a;
      border: 1px solid #8b7355;
      border-radius: 4px;
      padding: 4px;
      width: 100%;
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
    .archetype-warning {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
    }
    .archetype-warning.critical {
      background: rgba(239, 68, 68, 0.9);
      color: #fff;
    }
    .archetype-warning.info {
      background: rgba(251, 191, 36, 0.9);
      color: #1a1a1a;
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      🛡️ YOUR DEFENSE
      <div class="header-subtitle">${strategyLabel} STRATEGY • ${format} • ${visibleDefense.length} Squad${visibleDefense.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="squads-grid">
      ${squadRows}
    </div>
    ${unusedGLsSection}
  </div>
</body>
</html>`;

  logger.info(`[Defense Image] HTML generation complete: ${visibleDefense.length} squad(s)`);
  return html;
}

