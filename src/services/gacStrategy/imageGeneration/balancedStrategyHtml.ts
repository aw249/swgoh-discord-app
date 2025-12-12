/**
 * HTML generation for balanced strategy view showing three columns:
 * my-defense || my offense || opponents defence
 */
import { MatchedCounterSquad, UniqueDefensiveSquad, UniqueDefensiveSquadUnit, DefenseSuggestion } from '../../../types/gacStrategyTypes';
import { RelicDeltaModifiers } from '../../../utils/relicDeltaService';
import { SwgohGgFullPlayerResponse } from '../../../integrations/swgohGgApi';
import { getTop80CharactersRoster, getGalacticLegendsFromRoster, createCharacterMaps } from '../utils/rosterUtils';
import { isGalacticLegend } from '../../../config/gacConstants';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';
import { logger } from '../../../utils/logger';

export function generateBalancedStrategyHtml(
    opponentLabel: string,
    balancedOffense: MatchedCounterSquad[],
    balancedDefense: DefenseSuggestion[],
    opponentDefense: UniqueDefensiveSquad[],
    format: string = '5v5',
    maxSquads: number = 11,
    userRoster?: SwgohGgFullPlayerResponse,
    strategyPreference: 'defensive' | 'balanced' | 'offensive' = 'balanced'
  ): string {
    logger.info(`[Image Generation] Starting HTML generation for ${opponentLabel} (${format} format)`);
    logger.info(`[Image Generation] Input data: ${balancedOffense.length} offense squad(s), ${balancedDefense.length} defense squad(s), ${opponentDefense.length} opponent defense squad(s)`);
    logger.info(`[Image Generation] Max squads to display: ${maxSquads}`);
    
    const expectedSquadSize = format === '3v3' ? 3 : 5;
    
    // Limit to 4 squads as per wireframe
    const visibleDefense = balancedDefense.slice(0, maxSquads);
    const visibleOffense = balancedOffense.slice(0, maxSquads);
    const visibleOpponentDefense = opponentDefense.slice(0, maxSquads);
    
    logger.info(`[Image Generation] Visible squads after limiting to ${maxSquads}: ${visibleDefense.length} defense, ${visibleOffense.length} offense, ${visibleOpponentDefense.length} opponent defense`);

    // Create character name mapping from full user roster
    const characterNameMap = new Map<string, string>();
    const characterStatsMap = new Map<string, { speed: number; health: number; protection: number }>();
    if (userRoster && userRoster.units) {
      // Use full roster for all characters
      for (const unit of userRoster.units) {
        if (unit.data && unit.data.base_id && unit.data.combat_type === 1) {
          if (unit.data.name) {
            characterNameMap.set(unit.data.base_id, unit.data.name);
          }
          // Extract stats
          const stats = unit.data.stats || {};
          const speed = Math.round(stats['5'] || 0);
          const health = (stats['1'] || 0) / 1000; // Convert to K
          const protection = (stats['28'] || 0) / 1000; // Convert to K
          characterStatsMap.set(unit.data.base_id, { speed, health, protection });
        }
      }
    }

    // Collect all user GLs from full roster
    const allUserGLs = new Set<string>();
    if (userRoster && userRoster.units) {
      // Use full roster for all GLs (our list OR API flag)
      for (const unit of userRoster.units) {
        if (unit.data && unit.data.base_id && (isGalacticLegend(unit.data.base_id) || unit.data.is_galactic_legend)) {
          allUserGLs.add(unit.data.base_id);
        }
      }
    }

    // Track GLs used in offense
    const usedGLsInOffense = new Set<string>();
    for (const offense of balancedOffense) {
      if (offense.offense.leader.baseId && isGalacticLegend(offense.offense.leader.baseId)) {
        usedGLsInOffense.add(offense.offense.leader.baseId);
      }
    }

    // Track GLs used in defense
    const usedGLsInDefense = new Set<string>();
    for (const defense of balancedDefense) {
      if (defense.squad.leader.baseId && isGalacticLegend(defense.squad.leader.baseId)) {
        usedGLsInDefense.add(defense.squad.leader.baseId);
      }
    }

    logger.info(
      `[Image Generation] GL tracking: ${allUserGLs.size} total GL(s), ` +
      `${usedGLsInOffense.size} used in offense, ${usedGLsInDefense.size} used in defense`
    );

    // Helper to format baseId as a readable name with truncation
    const formatCharacterName = (baseId: string, maxLength: number = 15): string => {
      if (!baseId) return 'Name';
      const friendlyName = characterNameMap.get(baseId) || baseId;
      if (friendlyName.length > maxLength) {
        return friendlyName.substring(0, maxLength - 3) + '...';
      }
      return friendlyName;
    };

    // Helper to get character stats
    const getCharacterStats = (baseId: string): { speed: number; health: number; protection: number } | null => {
      return characterStatsMap.get(baseId) || null;
    };

    // Render defense squad with stats tables (no names)
    const renderDefenseSquad = (squad: UniqueDefensiveSquad, squadSize: number = expectedSquadSize): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders with proper layout
        const topRow = squadSize === 3 ? 2 : 2; // 3v3: 2 top
        const bottomRow = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
        const topPlaceholders = Array.from({ length: topRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait dark">
            <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        const bottomPlaceholders = Array.from({ length: bottomRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        return `<div class="squad-layout"><div class="squad-row">${topPlaceholders}</div><div class="squad-row">${bottomPlaceholders}</div></div>`;
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      // Layout: 3v3 = 2 top, 1 bottom; 5v5 = 2 top, 3 bottom
      const topRowCount = 2; // Always 2 on top
      const bottomRowCount = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
      
      const topUnits = allUnits.slice(0, topRowCount);
      const bottomUnits = allUnits.slice(topRowCount, topRowCount + bottomRowCount);

      const renderUnit = (unit: UniqueDefensiveSquadUnit | null, idx: number): string => {
        if (!unit) {
          return `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `;
        }
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        // Construct portrait URL from baseId if not provided
        // swgoh.gg serves character portraits from game-assets.swgoh.gg
        const portraitUrl = unit.portraitUrl || (unit.baseId ? getCharacterPortraitUrl(unit.baseId) : null);
        const portraitImg = portraitUrl
          ? `<img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none'; this.parentElement.querySelector('.character-placeholder')?.style.setProperty('display', 'flex');" />`
          : '';
        
        // Get stats for this character
        const stats = getCharacterStats(unit.baseId);
        const speedValue = stats ? stats.speed.toLocaleString() : '-';
        const healthValue = stats ? stats.health.toFixed(2) + 'K' : '-';
        const protectionValue = stats ? stats.protection.toFixed(2) + 'K' : '-';
        
        return `
          <div class="character-with-stats">
            <div class="character-portrait dark">
              ${portraitImg}
              <div class="character-placeholder" style="display: ${portraitImg ? 'none' : 'flex'};"></div>
              <div class="relic-number">${relic}</div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${speedValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">${healthValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">${protectionValue}</span>
              </div>
            </div>
          </div>
        `;
      };

      const topRowHtml = Array.from({ length: topRowCount }).map((_, idx) => 
        renderUnit(topUnits[idx] || null, idx)
      ).join('');
      
      const bottomRowHtml = Array.from({ length: bottomRowCount }).map((_, idx) => 
        renderUnit(bottomUnits[idx] || null, topRowCount + idx)
      ).join('');

      return `<div class="squad-layout"><div class="squad-row">${topRowHtml}</div><div class="squad-row">${bottomRowHtml}</div></div>`;
    };

    // Regular renderSquad for offense/opponent (with stats tables, no names)
    const renderSquad = (squad: UniqueDefensiveSquad, squadSize: number = expectedSquadSize, isOffense: boolean = false): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders with proper layout
        const topRow = squadSize === 3 ? 2 : 2; // 3v3: 2 top, 5v5: 2 top
        const bottomRow = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
        const topPlaceholders = Array.from({ length: topRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
            <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        const bottomPlaceholders = Array.from({ length: bottomRow }).map((_, idx) => `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `).join('');
        return `<div class="squad-layout"><div class="squad-row">${topPlaceholders}</div><div class="squad-row">${bottomPlaceholders}</div></div>`;
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      // Layout: 3v3 = 2 top, 1 bottom; 5v5 = 2 top, 3 bottom
      const topRowCount = 2; // Always 2 on top
      const bottomRowCount = squadSize === 3 ? 1 : 3; // 3v3: 1 bottom, 5v5: 3 bottom
      
      const topUnits = allUnits.slice(0, topRowCount);
      const bottomUnits = allUnits.slice(topRowCount, topRowCount + bottomRowCount);

      const renderUnit = (unit: UniqueDefensiveSquadUnit | null, idx: number): string => {
        if (!unit) {
          return `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              <div class="character-placeholder"></div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">-</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">-</span>
              </div>
            </div>
          </div>
        `;
        }
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        // Construct portrait URL from baseId if not provided
        // swgoh.gg serves character portraits from game-assets.swgoh.gg
        const portraitUrl = unit.portraitUrl || (unit.baseId ? getCharacterPortraitUrl(unit.baseId) : null);
        const portraitImg = portraitUrl
          ? `<img src="${portraitUrl}" alt="${unit.baseId}" onerror="this.style.display='none'; this.parentElement.querySelector('.character-placeholder')?.style.setProperty('display', 'flex');" />`
          : '';
        
        // Get stats for this character
        const stats = getCharacterStats(unit.baseId);
        const speedValue = stats ? stats.speed.toLocaleString() : '-';
        const healthValue = stats ? stats.health.toFixed(2) + 'K' : '-';
        const protectionValue = stats ? stats.protection.toFixed(2) + 'K' : '-';
        
        return `
          <div class="character-with-stats">
            <div class="character-portrait ${isOffense ? 'offense' : 'dark'}">
              ${portraitImg}
              <div class="character-placeholder" style="display: ${portraitImg ? 'none' : 'flex'};"></div>
              <div class="relic-number">${relic}</div>
            </div>
            <div class="character-stats-table">
              <div class="stat-row">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${speedValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Health</span>
                <span class="stat-value">${healthValue}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Prot</span>
                <span class="stat-value">${protectionValue}</span>
              </div>
            </div>
          </div>
        `;
      };

      const topRowHtml = Array.from({ length: topRowCount }).map((_, idx) => 
        renderUnit(topUnits[idx] || null, idx)
      ).join('');
      
      const bottomRowHtml = Array.from({ length: bottomRowCount }).map((_, idx) => 
        renderUnit(bottomUnits[idx] || null, topRowCount + idx)
      ).join('');

      return `<div class="squad-layout"><div class="squad-row">${topRowHtml}</div><div class="squad-row">${bottomRowHtml}</div></div>`;
    };

    const renderOffenseSquad = (match: MatchedCounterSquad, squadSize: number = expectedSquadSize): string => {
      // Use the regular renderSquad with isOffense=true
      return renderSquad(match.offense, squadSize, true);
    };

    // Create a map of offense to opponent defense to preserve original matchups
    const offenseToOpponentMap = new Map<MatchedCounterSquad, UniqueDefensiveSquad>();
    for (const offense of balancedOffense) {
      if (offense.defense && offense.defense.leader.baseId) {
        offenseToOpponentMap.set(offense, offense.defense);
        logger.debug(`[Image Generation] Mapped offense ${offense.offense.leader.baseId} -> opponent defense ${offense.defense.leader.baseId}`);
      }
    }
    
    logger.info(`[Image Generation] Created ${offenseToOpponentMap.size} offense-to-opponent-defense mapping(s) from ${balancedOffense.length} total offense squad(s)`);
    
    // Build rows - each row has: Defense | Offense Strategy | Relic Analysis
    const squadRows = Array.from({ length: maxSquads }).map((_, index) => {
      const myDefense = visibleDefense[index];
      const myOffense = visibleOffense[index];
      
      // Try to get opponent defense from the mapped offense, otherwise fall back to index
      let opponentDef: UniqueDefensiveSquad | undefined = undefined;
      let opponentDefSource = 'none';
      
      if (myOffense && offenseToOpponentMap.has(myOffense)) {
        opponentDef = offenseToOpponentMap.get(myOffense)!;
        opponentDefSource = 'mapped';
        logger.debug(`[Image Generation] Row ${index + 1}: Using mapped opponent defense ${opponentDef.leader.baseId} for offense ${myOffense.offense.leader.baseId}`);
      } else if (visibleOpponentDefense[index]) {
        opponentDef = visibleOpponentDefense[index];
        opponentDefSource = 'index-fallback';
        logger.debug(`[Image Generation] Row ${index + 1}: Using index-based opponent defense ${opponentDef.leader.baseId} (no mapping found for offense ${myOffense?.offense.leader.baseId || 'none'})`);
      } else {
        opponentDefSource = 'empty';
        let fallbackDefId = 'none';
        if (index < visibleOpponentDefense.length) {
          const fallbackDef = visibleOpponentDefense[index] as UniqueDefensiveSquad | undefined;
          if (fallbackDef) {
            fallbackDefId = fallbackDef.leader.baseId;
          }
        }
        logger.warn(`[Image Generation] Row ${index + 1}: No opponent defense available (offense: ${myOffense?.offense.leader.baseId || 'none'}, mapped: ${myOffense && offenseToOpponentMap.has(myOffense)}, index fallback: ${fallbackDefId})`);
      }
      
      logger.info(`[Image Generation] Row ${index + 1}: Defense=${myDefense?.squad.leader.baseId || 'none'}, Offense=${myOffense?.offense.leader.baseId || 'none'}, OpponentDef=${opponentDef?.leader.baseId || 'none'} (source: ${opponentDefSource})`);

      const myDefenseHtml = myDefense ? renderDefenseSquad(myDefense.squad, expectedSquadSize) : renderDefenseSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize);
      
      const myOffenseHtml = myOffense ? renderOffenseSquad(myOffense, expectedSquadSize) : renderSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize, true);
      
      const opponentDefHtml = opponentDef ? renderSquad(opponentDef, expectedSquadSize, false) : renderSquad({
        leader: { baseId: '', relicLevel: null, portraitUrl: null },
        members: []
      }, expectedSquadSize, false);

      // Build defense analysis HTML
      let defenseAnalysisHtml = '<div class="defense-analysis-box"><div class="defense-analysis-title">DEFENSE ANALYSIS</div></div>';
      if (myDefense) {
        const holdPercentage = myDefense.holdPercentage;
        const seenCount = myDefense.seenCount;
        const holdText = holdPercentage !== null ? `${holdPercentage.toFixed(0)}%` : 'N/A';
        const seenText = seenCount !== null ? seenCount.toLocaleString() : 'N/A';
        const holdColor = holdPercentage !== null ? (holdPercentage >= 50 ? '#4ade80' : holdPercentage >= 30 ? '#fbbf24' : '#f87171') : '#f5deb3';
        
        defenseAnalysisHtml = `
          <div class="defense-analysis-box">
            <div class="defense-analysis-title">DEFENSE ANALYSIS</div>
            <div class="defense-analysis-content" style="color: ${holdColor};">
              <span style="font-size: 18px; margin-right: 6px;">${holdPercentage !== null ? '🛡️' : '❓'}</span>
              <span>Hold %: ${holdText}</span>
            </div>
            <div class="defense-analysis-stats">
              <div class="stat-row">
                <span class="stat-label">Seen:</span>
                <span class="stat-value">${seenText}</span>
            </div>
            </div>
            </div>
        `;
      }

      // Build battle analysis HTML
      let battleAnalysisHtml = '<div class="battle-analysis-box"><div class="battle-analysis-title">BATTLE ANALYSIS</div></div>';
      if (myOffense && myOffense.keyMatchups && opponentDef) {
        const match = myOffense;
        const keyMatchups = match.keyMatchups;
        if (keyMatchups) {
          let displayDelta: number;
          let displayModifiers: RelicDeltaModifiers;
          
          if (keyMatchups.hasAdvantage) {
            const bestDelta = Math.max(
              keyMatchups.leaderVsLeader.delta,
              keyMatchups.highestOffenseVsHighestDefense.delta,
              keyMatchups.teamAverage.delta
            );
            if (bestDelta === keyMatchups.leaderVsLeader.delta) {
              displayDelta = keyMatchups.leaderVsLeader.delta;
              displayModifiers = keyMatchups.leaderVsLeader;
            } else if (bestDelta === keyMatchups.highestOffenseVsHighestDefense.delta) {
              displayDelta = keyMatchups.highestOffenseVsHighestDefense.delta;
              displayModifiers = keyMatchups.highestOffenseVsHighestDefense;
            } else {
              displayDelta = keyMatchups.teamAverage.delta;
              displayModifiers = keyMatchups.teamAverage;
            }
          } else if (keyMatchups.isTrap) {
            const worstDelta = Math.min(
              keyMatchups.leaderVsLeader.delta,
              keyMatchups.highestOffenseVsHighestDefense.delta,
              keyMatchups.teamAverage.delta
            );
            if (worstDelta === keyMatchups.leaderVsLeader.delta) {
              displayDelta = keyMatchups.leaderVsLeader.delta;
              displayModifiers = keyMatchups.leaderVsLeader;
            } else if (worstDelta === keyMatchups.highestOffenseVsHighestDefense.delta) {
              displayDelta = keyMatchups.highestOffenseVsHighestDefense.delta;
              displayModifiers = keyMatchups.highestOffenseVsHighestDefense;
            } else {
              displayDelta = keyMatchups.teamAverage.delta;
              displayModifiers = keyMatchups.teamAverage;
            }
          } else {
            displayDelta = keyMatchups.teamAverage.delta;
            displayModifiers = keyMatchups.teamAverage;
          }
          
          const getSimpleDescription = (delta: number, modifiers: RelicDeltaModifiers): { icon: string; text: string; color: string } => {
          const damageMod = ((modifiers.attackerDamageMultiplier - 1.0) * 100);
          
          if (delta >= 3) {
            return {
              icon: '🔥',
                text: `Much stronger (${Math.abs(delta).toFixed(0)} tiers higher)`,
              color: '#4ade80'
            };
          } else if (delta >= 2) {
            return {
              icon: '✅',
                text: `Stronger (${Math.abs(delta).toFixed(0)} tiers higher)`,
              color: '#4ade80'
            };
          } else if (delta >= 1) {
            return {
              icon: '✓',
                text: `Slightly stronger (${Math.abs(delta).toFixed(0)} tier higher)`,
              color: '#86efac'
            };
          } else if (delta === 0) {
            return {
              icon: '⚖️',
                text: 'Even match',
              color: '#f5deb3'
            };
          } else if (delta >= -2) {
            return {
              icon: '⚠️',
                text: `Slightly weaker (${Math.abs(delta).toFixed(0)} tier${Math.abs(delta) > 1 ? 's' : ''} lower)`,
              color: '#fbbf24'
            };
          } else if (delta >= -3) {
            return {
              icon: '❌',
                text: `Much weaker (${Math.abs(delta).toFixed(0)} tiers lower)`,
              color: '#f87171'
            };
          } else {
            return {
              icon: '🚫',
                text: `Very weak (${Math.abs(delta).toFixed(0)} tiers lower) - RISKY!`,
              color: '#dc2626'
            };
          }
          };
          
          const avgDesc = getSimpleDescription(displayDelta, displayModifiers);
          
          // Build stats section
          const displayWinRate = myOffense.adjustedWinPercentage ?? myOffense.winPercentage;
          const winRateText = displayWinRate !== null ? `${displayWinRate.toFixed(0)}%` : 'N/A';
          const seenCountText = myOffense.seenCount !== null ? myOffense.seenCount.toLocaleString() : 'N/A';
          
          battleAnalysisHtml = `
            <div class="battle-analysis-box">
              <div class="battle-analysis-title">BATTLE ANALYSIS</div>
              <div class="battle-analysis-content" style="color: ${avgDesc.color};">
                <span style="font-size: 18px; margin-right: 6px;">${avgDesc.icon}</span>
                <span>${avgDesc.text}</span>
                </div>
              <div class="battle-analysis-stats">
                <div class="stat-row">
                  <span class="stat-label">Win %:</span>
                  <span class="stat-value">${winRateText}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Seen:</span>
                  <span class="stat-value">${seenCountText}</span>
                </div>
              </div>
            </div>
          `;
        }
      }

      return {
        defenseRow: `
          <div class="defense-card">
            <div class="defense-header">
              <div class="squad-label">Squad ${index + 1}</div>
          </div>
            <div class="defense-content-wrapper">
              <div class="squad-layout">
                ${myDefenseHtml}
            </div>
              <div class="defense-analysis-column">
                ${defenseAnalysisHtml}
            </div>
          </div>
              </div>
        `,
        strategyRow: `
          <div class="strategy-card">
            <div class="strategy-header">
              <div class="squad-label">Squad ${index + 1}</div>
            </div>
            <div class="strategy-content-wrapper">
              <div class="strategy-squads">
                <div class="squad-layout">
                  ${myOffenseHtml}
            </div>
                <div class="vs-indicator">VS</div>
                <div class="squad-layout">
                  ${opponentDefHtml}
          </div>
        </div>
              <div class="battle-analysis-column">
                ${battleAnalysisHtml}
              </div>
            </div>
          </div>
        `
      };
    });

    const defenseRows = squadRows.map(r => r.defenseRow).join('');
    const strategyRows = squadRows.map(r => r.strategyRow).join('');

    // Remaining GLs section removed - all GLs should be used in battle

    // Calculate defense column width based on format
    const defenseMinWidth = format === '3v3' ? 750 : 840;
    const defenseMaxWidth = format === '3v3' ? 900 : 1050;
    const defenseColumnWidth = `min-width: ${defenseMinWidth}px; max-width: ${defenseMaxWidth}px;`;
    
    // Calculate strategy column width as 2.25x the defense column width
    const strategyMinWidth = Math.round(defenseMinWidth * 2.25);
    const strategyMaxWidth = Math.round(defenseMaxWidth * 2.25);
    const strategyColumnWidth = `min-width: ${strategyMinWidth}px; max-width: ${strategyMaxWidth}px;`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAC Strategy</title>
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
      color: white;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .main-container {
      display: flex;
      gap: 20px;
      width: fit-content;
      min-width: 100%;
      justify-content: center;
    }
    .defense-container {
      ${defenseColumnWidth}
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      padding: 20px;
      overflow: hidden;
    }
    .strategy-container {
      ${strategyColumnWidth}
      background: #2a2a2a;
      border: 2px solid #c4a35a;
      border-radius: 8px;
      padding: 20px;
      overflow: hidden;
    }
    .defense-container-header {
      background: #c4a35a;
      color: #1a1a1a;
      padding: 8px;
      font-weight: bold;
      text-align: center;
      font-size: 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .strategy-container-header {
      background: #c4a35a;
      color: #1a1a1a;
      padding: 8px;
      font-weight: bold;
      text-align: center;
      font-size: 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .strategy-card {
      background: #d4b56a;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      border: 1px solid #8b7355;
      display: flex;
      flex-direction: column;
      min-height: 200px;
    }
    .strategy-card:nth-child(even) {
      background: #b8935a;
    }
    .strategy-card:last-child {
      margin-bottom: 0;
    }
    .strategy-header {
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 10px 15px;
      color: #f5deb3;
      font-size: 16px;
      font-weight: bold;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      border-bottom: 1px solid #8b7355;
    }
    .strategy-content-wrapper {
      display: flex;
      padding: 15px;
      gap: 15px;
      align-items: flex-start;
      flex: 1;
    }
    .battle-analysis-column {
      flex-shrink: 0;
      width: 300px;
    }
    .defense-row {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid #8b7355;
      padding: 20px 0;
      align-items: flex-start;
      min-height: 150px;
      background: #d4b56a;
    }
    .defense-row:nth-child(even) {
      background: #b8935a;
    }
    .defense-row:last-child {
      border-bottom: none;
    }
    .squad-label {
      font-size: 16px;
      font-weight: normal;
      margin-bottom: 10px;
      color: #f5deb3;
      text-align: left;
    }
    .squad-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: center;
      align-items: center;
      flex: 1;
    }
    .squad-layout {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      width: 100%;
    }
    .squad-row {
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
    }
    .strategy-squads {
      display: flex;
      align-items: center;
      gap: 15px;
      width: 100%;
      flex: 1;
    }
    .strategy-squads .squad-layout {
      flex: 1;
      min-width: 0;
    }
    .vs-indicator {
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      color: #1a1a1a;
      text-transform: uppercase;
      letter-spacing: 2px;
      flex-shrink: 0;
    }
    .defense-analysis-wrapper {
      width: 100%;
      margin-top: 10px;
    }
    .character {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      width: 90px;
      flex-shrink: 0;
    }
    .character-portrait {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: 3px solid;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #4a4a4a;
      overflow: hidden;
      flex-shrink: 0;
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.dark {
      border-color: #c4a35a;
      box-shadow: 0 0 15px rgba(196, 163, 90, 0.4);
    }
    .character-portrait.offense {
      border-color: #4ade80;
      box-shadow: 0 0 15px rgba(74, 222, 128, 0.4);
    }
    .character-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(74, 74, 74, 0.3);
      border: 2px dashed #8b7355;
      flex-shrink: 0;
    }
    .character-name {
      font-size: 16px;
      text-align: center;
      color: #1a1a1a;
      width: 90px;
      word-wrap: break-word;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-weight: bold;
    }
    .relic-number {
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #000;
      font-weight: bold;
      font-size: 12px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #1a1a1a;
      z-index: 2;
    }
    .battle-analysis-box {
      width: 100%;
      min-height: 100px;
      border: 2px solid #c4a35a;
      border-radius: 6px;
      padding: 15px;
      background: #2a2a2a;
    }
    .battle-analysis-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      text-align: center;
      background: #c4a35a;
      color: #1a1a1a;
      padding: 6px;
      border-radius: 4px;
    }
    .battle-analysis-content {
      font-size: 16px;
      text-align: center;
      line-height: 1.5;
      margin-bottom: 10px;
      color: #f5deb3;
    }
    .battle-analysis-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 16px;
    }
    .battle-analysis-stats .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #2a2a2a !important;
      border-radius: 3px;
      margin-bottom: 0;
    }
    .battle-analysis-stats .stat-row .stat-label {
      font-weight: normal;
      color: #d3d3d3 !important;
    }
    .battle-analysis-stats .stat-row .stat-value {
      color: #d3d3d3 !important;
      font-weight: normal;
      text-align: right;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 16px;
      padding: 4px 8px;
      background: #b8935a;
      border-radius: 3px;
    }
    .stat-row:last-child {
      margin-bottom: 0;
    }
    .stat-row .stat-label {
      color: #1a1a1a;
      font-weight: bold;
    }
    .stat-row .stat-value {
      color: #1a1a1a;
      font-weight: bold;
    }
    .defense-card {
      background: #d4b56a;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      border: 1px solid #8b7355;
      display: flex;
      flex-direction: column;
      min-height: 200px;
    }
    .defense-card:nth-child(even) {
      background: #b8935a;
    }
    .defense-card:last-child {
      margin-bottom: 0;
    }
    .defense-header {
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 10px 15px;
      color: #f5deb3;
      font-size: 16px;
      font-weight: bold;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      border-bottom: 1px solid #8b7355;
    }
    .defense-content-wrapper {
      display: flex;
      padding: 15px;
      gap: 15px;
      align-items: flex-start;
      flex: 1;
    }
    .defense-analysis-column {
      flex-shrink: 0;
      width: 150px;
    }
    .character-with-stats {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .character-stats-table {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      min-width: 140px;
      background: #2a2a2a;
      border: 1px solid #8b7355;
      border-radius: 4px;
      padding: 8px;
    }
    .character-stats-table .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      background: #1a1a1a;
      border-radius: 2px;
      margin-bottom: 0;
    }
    .character-stats-table .stat-label {
      font-size: 12px;
      color: #8b7355;
      text-transform: uppercase;
      font-weight: bold;
    }
    .character-stats-table .stat-value {
      font-size: 14px;
      color: #f5deb3;
      font-weight: bold;
    }
    .defense-analysis-box {
      width: 100%;
      min-height: 100px;
      border: 2px solid #c4a35a;
      border-radius: 6px;
      padding: 15px;
      background: #2a2a2a;
    }
    .defense-analysis-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 10px;
      text-align: center;
      background: #c4a35a;
      color: #1a1a1a;
      padding: 6px;
      border-radius: 4px;
    }
    .defense-analysis-content {
      font-size: 16px;
      text-align: center;
      line-height: 1.5;
      margin-bottom: 10px;
      color: #f5deb3;
    }
    .defense-analysis-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 16px;
      color: #f5deb3;
    }
    .defense-analysis-stats .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #1a1a1a;
      border-radius: 3px;
      margin-bottom: 0;
    }
    .defense-analysis-stats .stat-label {
      font-weight: bold;
      color: #f5deb3;
    }
    .defense-analysis-stats .stat-value {
      color: #f5deb3;
    }
  </style>
</head>
<body>
  <div class="main-container">
    <div class="defense-container">
      <div class="defense-container-header">YOUR DEFENSE${strategyPreference === 'defensive' ? ' (DEFENSIVE STRATEGY)' : strategyPreference === 'offensive' ? ' (OFFENSIVE STRATEGY)' : ' (BALANCED STRATEGY)'}</div>
      ${defenseRows}
    </div>
    <div class="strategy-container">
      <div class="strategy-container-header">YOUR GAC STRATEGY</div>
      ${strategyRows}
    </div>
  </div>
</body>
</html>`;
    
    logger.info(`[Image Generation] HTML generation complete: ${squadRows.length} row(s) generated`);
    return html;
  }

