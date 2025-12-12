/**
 * HTML generation for defense-only view (no offense side, no relic delta comparison).
 * Uses a narrower layout optimized for showing just defense squads.
 */
import { UniqueDefensiveSquad } from '../../../types/gacStrategyTypes';
import { getCharacterPortraitUrl } from '../../../config/characterPortraits';

export function generateDefenseOnlyHtml(opponentLabel: string, squads: UniqueDefensiveSquad[], format: string = '5v5'): string {
    const maxSquads = 12;
    const visibleSquads = squads.slice(0, maxSquads);
    const expectedSquadSize = format === '3v3' ? 3 : 5;

    const renderSquad = (squad: UniqueDefensiveSquad): string => {
      if (!squad.leader.baseId) {
        // Empty squad - show placeholders
        return Array.from({ length: expectedSquadSize }).map(() => `
          <div class="character">
            <div class="character-placeholder"></div>
          </div>
        `).join('');
      }

      const allUnits = [squad.leader, ...squad.members];
      const totalSlots = expectedSquadSize;
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
        return `
          <div class="character">
            <div class="character-portrait dark">
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

    const squadCards = visibleSquads.map((squad, index) => {
      const defenseHtml = renderSquad(squad);
      const squadTitle = `Squad ${index + 1}`;

      return `
        <div class="battle-card">
          <div class="battle-header">
            <div class="defender-name">${squadTitle}</div>
          </div>
          <div style="display: flex; justify-content: center;">
            <div class="squad-container">
              <div class="squad-label">Defense</div>
              <div class="squad">${defenseHtml}</div>
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
  <title>GAC Defense</title>
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
      max-width: 600px;
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
    .squad-container {
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
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">GAC Strategy – ${opponentLabel}</h1>
    <p class="subtitle">Your suggested defense squads (${format} format).</p>
    ${squadCards}
  </div>
</body>
</html>`;
  }
