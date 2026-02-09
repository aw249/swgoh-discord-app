/**
 * HTML generation for matched offense vs defense squads view.
 * Shows offense counters against opponent's defensive squads with stats.
 */
import { MatchedCounterSquad, UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';
import { RelicDeltaModifiers } from '../../../utils/relicDeltaService';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';

export function generateMatchedCountersHtml(opponentLabel: string, matchedCounters: MatchedCounterSquad[], format: string = '5v5'): string {
    const maxSquads = 12;
    const visibleCounters = matchedCounters.slice(0, maxSquads);
    const expectedSquadSize = format === '3v3' ? 3 : 5;

    const renderSquad = (squad: UniqueDefensiveSquad, isOffense: boolean, squadSize: number = expectedSquadSize): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders
        return Array.from({ length: squadSize }).map(() => `
          <div class="character">
            <div class="character-placeholder"></div>
          </div>
        `).join('');
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = squadSize;
      const usedSlots = allUnits.length;
      const emptySlots = Math.max(0, totalSlots - usedSlots);

      const unitHtml = allUnits.map((unit) => {
        let relic: string | number = '?';
        if (typeof unit.relicLevel === 'number') {
          relic = Math.max(0, Math.min(10, unit.relicLevel));
        }
        const portraitUrl = unit.portraitUrl || (unit.baseId ? getCharacterPortraitUrl(unit.baseId) : null);
        const portraitImg = portraitUrl
          ? `<img src="${portraitUrl}" alt="${unit.baseId}" />`
          : '';
        const portraitClass = isOffense ? 'character-portrait offense' : 'character-portrait dark';
        return `
          <div class="character">
            <div class="${portraitClass}">
              ${portraitImg}
              <div class="relic-number">${relic}</div>
            </div>
            <div class="stars">
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
              <div class="star"></div>
            </div>
          </div>
        `;
      }).join('');

      const placeholders = Array.from({ length: emptySlots }).map(() => `
        <div class="character">
          <div class="character-placeholder"></div>
        </div>
      `).join('');

      return unitHtml + placeholders;
    };

    const squadCards = visibleCounters.map((match, index) => {
      const offenseHtml = renderSquad(match.offense, true, expectedSquadSize);
      const defenseHtml = renderSquad(match.defense, false, expectedSquadSize);
      const squadTitle = `Squad ${index + 1}`;
      
      // Build stats HTML
      const statItems: string[] = [];
      
      // Show adjusted win rate (preferred) or base win rate
      const displayWinRate = match.adjustedWinPercentage ?? match.winPercentage;
      if (displayWinRate !== null) {
        const isAdjusted = match.adjustedWinPercentage !== null && match.adjustedWinPercentage !== match.winPercentage;
        const winRateColor = displayWinRate >= 70 ? '#4ade80' : displayWinRate >= 50 ? '#fbbf24' : '#f87171';
        
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">${isAdjusted ? 'Adj Win %' : 'Win %'}</span>
            <span class="stat-value" style="color: ${winRateColor}">${displayWinRate.toFixed(0)}%</span>
            ${isAdjusted && match.winPercentage !== null ? `
              <span class="stat-subtext" style="color: #8b7355; font-size: 10px;">
                (Base: ${match.winPercentage}%)
              </span>
            ` : ''}
          </div>
        `);
      }
      
      if (match.seenCount !== null) {
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">Seen</span>
            <span class="stat-value">${match.seenCount.toLocaleString()}</span>
          </div>
        `);
      }
      
      if (match.avgBanners !== null) {
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">Avg Banners</span>
            <span class="stat-value">${match.avgBanners.toFixed(1)}</span>
          </div>
        `);
      }
      
      // Add Relic Delta information if available (simplified for stats bar)
      if (match.relicDelta) {
        const delta = match.relicDelta.delta;
        const deltaColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#f5deb3';
        
        // Use simple language for the stat bar
        let deltaLabel = 'Relic Match';
        let deltaValue = 'Even';
        if (delta > 2) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tiers higher`;
        } else if (delta > 0) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tier higher`;
        } else if (delta < -2) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tiers lower`;
        } else if (delta < 0) {
          deltaLabel = 'Relic Level';
          deltaValue = `${Math.abs(delta).toFixed(0)} tier lower`;
        }
        
        statItems.push(`
          <div class="stat-item">
            <span class="stat-label">${deltaLabel}</span>
            <span class="stat-value" style="color: ${deltaColor}">${deltaValue}</span>
          </div>
        `);
      }
      
      // Add simplified Relic Delta metrics section - only overall team comparison
      // Always from offense team's perspective - use the most representative delta
      let relicDeltaDetailsHtml = '';
      if (match.keyMatchups) {
        // Use the most representative delta: best if advantage, worst if trap, otherwise average
        // This ensures consistency with the advantage/trap detection
        let displayDelta: number;
        let displayModifiers: RelicDeltaModifiers;
        
        if (match.keyMatchups.hasAdvantage) {
          // If we have advantage, show the best case (most favorable for offense)
          const bestDelta = Math.max(
            match.keyMatchups.leaderVsLeader.delta,
            match.keyMatchups.highestOffenseVsHighestDefense.delta,
            match.keyMatchups.teamAverage.delta
          );
          // Find which matchup corresponds to this best delta
          if (bestDelta === match.keyMatchups.leaderVsLeader.delta) {
            displayDelta = match.keyMatchups.leaderVsLeader.delta;
            displayModifiers = match.keyMatchups.leaderVsLeader;
          } else if (bestDelta === match.keyMatchups.highestOffenseVsHighestDefense.delta) {
            displayDelta = match.keyMatchups.highestOffenseVsHighestDefense.delta;
            displayModifiers = match.keyMatchups.highestOffenseVsHighestDefense;
          } else {
            displayDelta = match.keyMatchups.teamAverage.delta;
            displayModifiers = match.keyMatchups.teamAverage;
          }
        } else if (match.keyMatchups.isTrap) {
          // If it's a trap, show the worst case (least favorable for offense)
          const worstDelta = Math.min(
            match.keyMatchups.leaderVsLeader.delta,
            match.keyMatchups.highestOffenseVsHighestDefense.delta,
            match.keyMatchups.teamAverage.delta
          );
          // Find which matchup corresponds to this worst delta
          if (worstDelta === match.keyMatchups.leaderVsLeader.delta) {
            displayDelta = match.keyMatchups.leaderVsLeader.delta;
            displayModifiers = match.keyMatchups.leaderVsLeader;
          } else if (worstDelta === match.keyMatchups.highestOffenseVsHighestDefense.delta) {
            displayDelta = match.keyMatchups.highestOffenseVsHighestDefense.delta;
            displayModifiers = match.keyMatchups.highestOffenseVsHighestDefense;
          } else {
            displayDelta = match.keyMatchups.teamAverage.delta;
            displayModifiers = match.keyMatchups.teamAverage;
          }
        } else {
          // Otherwise use team average
          displayDelta = match.keyMatchups.teamAverage.delta;
          displayModifiers = match.keyMatchups.teamAverage;
        }
        
        const avgDelta = displayDelta;
        const avgModifiers = displayModifiers;
        
        const getSimpleDescription = (delta: number, modifiers: RelicDeltaModifiers): { icon: string; text: string; color: string } => {
          const damageMod = ((modifiers.attackerDamageMultiplier - 1.0) * 100);
          
          if (delta >= 3) {
            return {
              icon: '🔥',
              text: `Much stronger (${Math.abs(delta).toFixed(0)} tiers higher) - You deal ${Math.abs(damageMod).toFixed(0)}% MORE damage`,
              color: '#4ade80'
            };
          } else if (delta >= 2) {
            return {
              icon: '✅',
              text: `Stronger (${Math.abs(delta).toFixed(0)} tiers higher) - You deal ${Math.abs(damageMod).toFixed(0)}% more damage`,
              color: '#4ade80'
            };
          } else if (delta >= 1) {
            return {
              icon: '✓',
              text: `Slightly stronger (${Math.abs(delta).toFixed(0)} tier higher) - Small damage boost`,
              color: '#86efac'
            };
          } else if (delta === 0) {
            return {
              icon: '⚖️',
              text: 'Even match - Same relic levels',
              color: '#f5deb3'
            };
          } else if (delta >= -2) {
            return {
              icon: '⚠️',
              text: `Slightly weaker (${Math.abs(delta).toFixed(0)} tier${Math.abs(delta) > 1 ? 's' : ''} lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage`,
              color: '#fbbf24'
            };
          } else if (delta >= -3) {
            return {
              icon: '❌',
              text: `Much weaker (${Math.abs(delta).toFixed(0)} tiers lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage`,
              color: '#f87171'
            };
          } else {
            return {
              icon: '🚫',
              text: `Very weak (${Math.abs(delta).toFixed(0)} tiers lower) - You deal ${Math.abs(damageMod).toFixed(0)}% LESS damage - RISKY!`,
              color: '#dc2626'
            };
          }
        };
        
        const avgDesc = getSimpleDescription(avgDelta, avgModifiers);
        
        relicDeltaDetailsHtml = `
          <div class="relic-delta-details" style="
            background: #1a1a1a;
            border: 1px solid #8b7355;
            border-radius: 6px;
            padding: 12px;
            font-size: 12px;
            height: fit-content;
          ">
            <div style="
              font-weight: bold;
              color: #f5deb3;
              margin-bottom: 10px;
              border-bottom: 1px solid #8b7355;
              padding-bottom: 6px;
              font-size: 13px;
            ">📊 Relic Delta Comparison</div>
            <div style="
              background: #2a2a2a;
              padding: 10px;
              border-radius: 4px;
              border-left: 3px solid ${avgDesc.color};
            ">
              <div style="color: ${avgDesc.color}; font-size: 13px; line-height: 1.5;">
                <span style="font-size: 16px; margin-right: 6px;">${avgDesc.icon}</span> ${avgDesc.text}
              </div>
            </div>
          </div>
        `;
      }
      
      // Add trap warning if applicable
      let warningHtml = '';
      if (match.keyMatchups?.isTrap) {
        const worstDelta = Math.min(
          match.keyMatchups.leaderVsLeader.delta,
          match.keyMatchups.highestOffenseVsHighestDefense.delta,
          match.keyMatchups.teamAverage.delta
        );
        const yourDamageMod = match.relicDelta ? ((match.relicDelta.attackerDamageMultiplier - 1.0) * 100) : 0;
        const enemyDamageMod = match.relicDelta ? ((1.0 - match.relicDelta.defenderDamageMultiplier) * 100) : 0;
        const yourDamageSign = yourDamageMod >= 0 ? '+' : '';
        const enemyDamageSign = enemyDamageMod >= 0 ? '+' : '';
        
        const tierWord = Math.abs(worstDelta) === 1 ? 'tier' : 'tiers';
        warningHtml = `
          <div class="trap-warning" style="
            background: #7f1d1d;
            border: 2px solid #dc2626;
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            color: #fca5a5;
            font-size: 13px;
            line-height: 1.5;
          ">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
              ⚠️ WARNING: Your Team is Weaker
            </div>
            <div style="font-size: 12px;">
              Your team is <strong>${Math.abs(worstDelta).toFixed(0)} relic ${tierWord} lower</strong> than the enemy.
              <br/>
              • You deal <strong>${Math.abs(yourDamageMod).toFixed(0)}% LESS damage</strong> than normal
              <br/>
              • Enemy deals <strong>${Math.abs(enemyDamageMod).toFixed(0)}% MORE damage</strong> to you
              <br/>
              <span style="color: #fca5a5; font-weight: bold;">This counter may fail even if it usually works!</span>
            </div>
          </div>
        `;
      } else if (match.keyMatchups?.hasAdvantage) {
        const bestDelta = Math.max(
          match.keyMatchups.leaderVsLeader.delta,
          match.keyMatchups.highestOffenseVsHighestDefense.delta,
          match.keyMatchups.teamAverage.delta
        );
        const yourDamageMod = match.relicDelta ? ((match.relicDelta.attackerDamageMultiplier - 1.0) * 100) : 0;
        const damageSign = yourDamageMod >= 0 ? '+' : '';
        
        const tierWord = bestDelta === 1 ? 'tier' : 'tiers';
        warningHtml = `
          <div class="advantage-notice" style="
            background: #14532d;
            border: 2px solid #22c55e;
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            color: #86efac;
            font-size: 13px;
            line-height: 1.5;
          ">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
              ✓ Advantage: Your Team is Stronger
            </div>
            <div style="font-size: 12px;">
              Your team is <strong>${bestDelta.toFixed(0)} relic ${tierWord} higher</strong> than the enemy.
              <br/>
              • You deal <strong>${Math.abs(yourDamageMod).toFixed(0)}% MORE damage</strong> than normal
              <br/>
              • Enemy deals <strong>less damage</strong> to you
              <br/>
              <span style="color: #86efac; font-weight: bold;">This counter should work well!</span>
            </div>
          </div>
        `;
      }
      
      const statsHtml = statItems.length > 0 ? `
        <div class="battle-stats">
          ${statItems.join('')}
        </div>
      ` : '';

      // Determine card border color based on Relic Delta status
      let cardBorderStyle = '';
      if (match.keyMatchups?.isTrap) {
        cardBorderStyle = 'border-color: #dc2626; border-width: 3px;';
      } else if (match.keyMatchups?.hasAdvantage) {
        cardBorderStyle = 'border-color: #22c55e; border-width: 3px;';
      }

      return `
        <div class="battle-card" style="${cardBorderStyle}">
          <div class="battle-header">
            <div class="defender-name">${squadTitle}</div>
            ${match.keyMatchups?.isTrap ? `
              <div style="
                background: #dc2626;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: bold;
              ">⚠️ TRAP</div>
            ` : match.keyMatchups?.hasAdvantage ? `
              <div style="
                background: #22c55e;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: bold;
              ">✓ ADVANTAGE</div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 20px; align-items: flex-start;">
            <div style="flex: 1;">
              <div class="battle-content">
                <div class="squad-container">
                  <div class="squad-label">Offense</div>
                  <div class="squad">${offenseHtml}</div>
                </div>
                <div class="vs-divider">VS</div>
                <div class="squad-container">
                  <div class="squad-label">Defense</div>
                  <div class="squad">${defenseHtml}</div>
                </div>
              </div>
          ${statsHtml}
            </div>
            <div style="flex: 0 0 280px; min-width: 280px;">
              ${relicDeltaDetailsHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
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
    .container {
      max-width: 1400px;
      width: 100%;
    }
    .title {
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
      font-weight: bold;
      color: #f5deb3;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
      background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #c4a35a;
      margin-bottom: 20px;
    }
    .subtitle {
      text-align: center;
      margin-bottom: 20px;
      font-size: 16px;
      color: #f5deb3;
    }
    .battle-card {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 18px;
      border: 2px solid #c4a35a;
    }
    .battle-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid #8b7355;
    }
    .defender-name {
      font-size: 20px;
      font-weight: bold;
      color: #f5deb3;
    }
    .battle-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 12px;
    }
    .squad-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .squad-label {
      font-size: 14px;
      font-weight: bold;
      color: #f5deb3;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .vs-divider {
      font-size: 18px;
      font-weight: bold;
      color: #c4a35a;
      padding: 0 10px;
    }
    .squad {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: nowrap;
      justify-content: center;
    }
    .character {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
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
    }
    .character-portrait img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    .character-portrait.offense {
      border-color: #4ade80;
      box-shadow: 0 0 15px rgba(74, 222, 128, 0.4);
    }
    .character-portrait.dark {
      border-color: #c4a35a;
      box-shadow: 0 0 15px rgba(196, 163, 90, 0.4);
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
    .stars {
      display: flex;
      gap: 2px;
      margin-top: 4px;
    }
    .star {
      width: 6px;
      height: 6px;
      background: #fbbf24;
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
    }
    .character-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(74, 74, 74, 0.3);
      border: 2px dashed #8b7355;
    }
    .battle-stats {
      display: flex;
      gap: 20px;
      justify-content: center;
      padding-top: 12px;
      border-top: 1px solid #8b7355;
      margin-top: 12px;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .stat-label {
      font-size: 11px;
      color: #8b7355;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 16px;
      font-weight: bold;
      color: #f5deb3;
    }
    .stat-subtext {
      display: block;
      font-size: 10px;
      color: #8b7355;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">GAC Strategy – ${opponentLabel}</h1>
    <p class="subtitle">Matched offense counters vs opponent's defensive squads (best matches from your roster).</p>
    ${squadCards}
  </div>
</body>
</html>`;
  }

