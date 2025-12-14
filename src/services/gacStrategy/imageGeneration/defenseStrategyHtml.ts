/**
 * HTML generation for defense strategy view (standalone defense image).
 * Uses GL-style layout from player comparison for consistency.
 */
import { DefenseSuggestion, UniqueDefensiveSquadUnit } from '../../../types/gacStrategyTypes';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { isGalacticLegend } from '../../../config/gacConstants';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';
import { logger } from '../../../utils/logger';
import { getDisplayRelicLevel, getUnitLevelDisplay } from '../../../utils/unitLevelUtils';

// Base64 stat icons (same as player comparison for consistency)
const SPEED_ICON = 'data:image/webp;base64,UklGRh4CAABXRUJQVlA4TBICAAAvH8AHEJVAbCRJkbT+Ox0PvbP3YEA9Qx1ESAIAsIykrm3b9v5s27Zt27Zt27Zt28b51pmAvKIQYCJCg50EY77S1Bhz7EIRuiW4BBhxE6dU49W2O/+AfbOIVuARYcFPsjpDFmx66irnlREsVFT40WKlwJqf+UnuoUS4R2XkESTUJ/4JauhLUPG5bmtPOlmU2h85whTsTrVRSKDhpMJGgFwNuo04AUYfRhW59uxAB8FEKVBRCVQcVNnwl6/H7Gfrtx1fbevTf5cysSVEvQIOUWcXDDRVrTAoVBV7bVvf3jxopKa3/c8iOvt1hiC5+vVo1znGFcg4uFFMoqqjj0FyDoJDiYv92+CFDnPD/gGese1Ax0ntIluzaadefXRWvkEBh0ec8OzCJcFeiHK9Zm0492vyh8gGnRQ2CjzaJrX/p0lQuR38J7BBJwQLDSEa7KqAUV0OwiXKkp9sNQZsuPMfGL3gO0SSMR+Fuiw68OB70r1Bx/+RJTARUfE4XZViOYLBg5+ScSQifQP1y7+29cgT7pocoPVbLhNHrXfWNC32sQkKSxeV/re9tVUNcYOQ8HLVtl7V4F0IRGbOb0DbT3QblASLQp9AW7eCYO4lZ0b6HAFlskEzKQNe29YS5YUkCAWIzSK9M9BWzFoClTC1Pw48RMhSol6jcmtAawXuGhjoqAnSZMqBtzDp6nQbsWI19lzR3qBXEQ==';
const HEALTH_ICON = 'data:image/webp;base64,UklGRswAAABXRUJQVlA4TMAAAAAvH8AHEIXjRpIUqfx3Opau4egdATXbtmXZg7tFG8CzL8BBsi8yxHuQiFQGcKju0ojMQHJ3T/x6T0Doi1rBs9Q/QEhHR0dHucEHAGDwzcRr7i/9Ffj9gpOZmcILaEsxe4IuWajYUzIBBYLQhn+QCNV74G1YHCq/h1pV0y+Au3OrLAkA8nA3Co2KAgDGscDpA4CFFpjsAbDQFJmsrKwxABYao4E7FlqyCr2T3JKJYKhLhMPhcAIvPMSIQ5tsivShrwo=';
const PROTECTION_ICON = 'data:image/webp;base64,UklGRsYAAABXRUJQVlA4TLoAAAAvH8AHEFU4bhvJkTb/pHm2u8++a3Yi3AYAQDbRpguSKaNHfGFfkDMwp1y78gGvbj/gAbYxAfmxBI2T+Aqkkq//mYWaQkjczofZiAmI0Nq/uIWrRTXzb4ZaI+mdg/qkiqn/aCq6M6koz6QimhFXuDOpYGd2BWQ3YQ+qRH1ipyyYWDWoc29Da1HsKaaJ9upkdSLtyBxAG2FVy+6F7FlZlEzSfJ6tnVm6yyMXeqYxJncrBzAPYuobZB/Afwk=';

export function generateDefenseStrategyHtml(
  playerName: string,
  defenseSquads: DefenseSuggestion[],
  format: string = '5v5',
  maxSquads: number = 11,
  userRoster?: SwgohGgFullPlayerResponse,
  strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
): string {
  logger.info(`[Defense Image] Starting HTML generation for ${playerName} (${format} format)`);
  logger.info(`[Defense Image] Input data: ${defenseSquads.length} defense squad(s)`);

  const expectedSquadSize = format === '3v3' ? 3 : 5;
  const visibleDefense = defenseSquads.slice(0, maxSquads);

  // Create character stats AND level mapping from FULL user roster (not just top 80)
  const characterStatsMap = new Map<string, { speed: number; health: number; protection: number; relic: number | null; gearLevel: number; levelLabel: string }>();
  if (userRoster && userRoster.units) {
    // Use FULL roster to ensure all characters have stats
    for (const unit of userRoster.units) {
      if (unit.data && unit.data.base_id && unit.data.combat_type === 1) {
        const stats = unit.data.stats || {};
        const speed = Math.round(stats['5'] || 0);
        const health = (stats['1'] || 0) / 1000;
        const protection = (stats['28'] || 0) / 1000;
        // Get relic level using utility function
        const relic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier);
        const levelDisplay = getUnitLevelDisplay(unit.data);
        characterStatsMap.set(unit.data.base_id, { 
          speed, 
          health, 
          protection, 
          relic,
          gearLevel: unit.data.gear_level,
          levelLabel: levelDisplay.label
        });
      }
    }
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
        // Missing required abilities - show critical warning
        const missingAbilities = archVal.missingRequired?.slice(0, 2).map(m => {
          const unitId = m.unitBaseId.replace(/_/g, ' ');
          return unitId;
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
        </div>
      </div>
    `;
  };

  const squadRows = visibleDefense.map((def, idx) => renderSquadRow(def, idx)).join('');
  const strategyLabel = strategyPreference === 'defensive' ? 'DEFENSIVE' : strategyPreference === 'offensive' ? 'OFFENSIVE' : 'BALANCED';

  // Calculate width based on format (3v3 needs less width than 5v5)
  const containerWidth = format === '3v3' ? 700 : 950;

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
    .squad-row {
      background: #d4b56a;
      border-bottom: 2px solid #8b7355;
      padding: 12px 16px;
    }
    .squad-row:nth-child(even) {
      background: #b8935a;
    }
    .squad-row:last-child {
      border-bottom: none;
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
    }
    .character-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: ${format === '3v3' ? 200 : 170}px;
    }
    .character-cell.gl .character-portrait {
      border-color: #fbbf24;
      box-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
    }
    .character-portrait {
      width: 70px;
      height: 70px;
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
    .character-stats {
      background: #2a2a2a;
      border: 1px solid #8b7355;
      border-radius: 4px;
      padding: 6px;
      width: 100%;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 6px;
      background: #1a1a1a;
      border-radius: 2px;
      margin-bottom: 2px;
      font-size: 11px;
    }
    .stat-row:last-child {
      margin-bottom: 0;
    }
    .stat-label {
      color: #8b7355;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .stat-icon {
      width: 14px;
      height: 14px;
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      🛡️ YOUR DEFENSE
      <div class="header-subtitle">${strategyLabel} STRATEGY • ${format} • ${visibleDefense.length} Squad${visibleDefense.length !== 1 ? 's' : ''}</div>
    </div>
    ${squadRows}
  </div>
</body>
</html>`;

  logger.info(`[Defense Image] HTML generation complete: ${visibleDefense.length} squad(s)`);
  return html;
}

