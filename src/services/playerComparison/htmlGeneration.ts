/**
 * HTML generation for player comparison
 */
import { SwgohGgFullPlayerResponse, SwgohGgUnit } from '../../integrations/swgohGgApi';
import { 
  GALACTIC_LEGEND_IDS, 
  getGLStats, 
  fmt, 
  escapeHtml, 
  countZetas, 
  countOmicrons, 
  countGearLevel, 
  calculateModStats 
} from './utils';

export   function generateHTML(
    p1: SwgohGgFullPlayerResponse,
    p2: SwgohGgFullPlayerResponse,
    characterImageCache: Map<string, string>
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SWGOH GAC Profiles</title>
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
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }
        .container {
            display: flex;
            gap: 20px;
            flex-wrap: nowrap;
            justify-content: center;
            width: 100%;
            max-width: 940px;
        }
        .profile-card {
            width: 450px;
            background: #2a2a2a;
            border: 2px solid #c4a35a;
            border-radius: 8px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #3a2a1a 0%, #1a1410 100%);
            padding: 20px;
            text-align: center;
            color: #f5deb3;
            font-size: 28px;
            font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        }
        .section {
            background: #c4a35a;
            padding: 8px;
            font-weight: bold;
            text-align: center;
            color: #1a1a1a;
            border-top: 2px solid #8b7355;
        }
        .content-row {
            display: flex;
            background: #d4b56a;
            border-bottom: 1px solid #8b7355;
        }
        .content-row.dark {
            background: #b8935a;
        }
        .label {
            flex: 1;
            padding: 6px 10px;
            font-weight: bold;
            color: #1a1a1a;
        }
        .value {
            flex: 1;
            padding: 6px 10px;
            color: #1a1a1a;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr 1fr;
            background: #d4b56a;
        }
        .stat-cell {
            padding: 6px 8px;
            border: 1px solid #8b7355;
            text-align: center;
            font-size: 11px;
        }
        .stat-label {
            font-weight: bold;
            color: #1a1a1a;
        }
        .stat-value {
            color: #1a1a1a;
            font-weight: bold;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1px;
            background: #8b7355;
            padding: 1px;
        }
        .summary-item {
            background: #d4b56a;
            padding: 8px 4px;
            text-align: center;
        }
        .summary-label {
            font-size: 10px;
            color: #1a1a1a;
            margin-bottom: 2px;
        }
        .gac-summary-label {
            font-size: 10px;
            color: #1a1a1a;
            margin-bottom: 2px;
        }
        .summary-value {
            font-weight: bold;
            color: #1a1a1a;
            font-size: 13px;
        }
        .gac-summary-value {
            font-weight: bold;
            color: #1a1a1a;
            font-size: 13px;
        }
        .mod-analysis {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1px;
            background: #8b7355;
        }
        .mod-row {
            display: contents;
        }
        .mod-cell {
            padding: 5px 8px;
            background: #d4b56a;
            text-align: center;
            font-size: 11px;
        }
        .mod-cell {
            color: #1a1a1a;
        }
        .mod-cell.green {
            background-color: #7cb342;
            color: #ffffff;
        }
        .mod-cell.red {
            background-color: #ef5350;
            color: #ffffff;
        }
        .legends-section {
            background: #d4b56a;
            padding: 0 0 1px 0;
            width: 100%;
        }
        .legend-item {
            margin-bottom: 0;
            border-bottom: 2px solid #8b7355;
        }
        .legend-item:last-child {
            border-bottom: none;
        }
        .legend-table {
            display: grid;
            grid-template-columns: 80px repeat(4, 1fr);
            grid-template-rows: repeat(3, auto);
            gap: 1px;
            background: #8b7355;
            width: 100%;
        }
        .legend-image-cell {
            grid-row: 1 / 4;
            background: #d4b56a;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 5px;
        }
        .legend-image-cell img {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            object-fit: cover;
        }
        .legend-table-cell {
            padding: 5px 8px;
            background: #d4b56a;
            text-align: center;
            font-size: 11px;
            color: #1a1a1a;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }
        .legend-table-cell.stat-label-cell {
            font-weight: bold;
            justify-content: flex-start;
        }
        .legend-table-cell.stat-value-cell {
            font-weight: bold;
        }
        .legend-table-cell.green {
            background-color: #7cb342;
            color: #ffffff;
        }
        .legend-table-cell.red {
            background-color: #ef5350;
            color: #ffffff;
        }
        .legend-stat-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }
        .stat-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
        }
        .stat-item.full-width {
            width: 100%;
        }
        .stat-item.full-width .stat-value {
            flex: 1;
            margin-left: auto;
            font-size: 1.2em;
        }
        .stats-row {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
        }
        .stat-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }
        .stat-label {
            font-weight: bold;
            min-width: 50px;
            color: #f5deb3;
        }
        .gac-stat-label {
            font-size: 10px;
            color: #1a1a1a;
            margin-bottom: 2px;
        }
        .stat-value {
            font-weight: bold;
            color: #f5deb3;
            display: inline-block;
            min-width: 60px;
            text-align: center;
        }
        .stat-value.green {
            background-color: #7cb342;
            color: #ffffff;
            padding: 4px 8px;
            border-radius: 3px;
            min-height: 20px;
            line-height: 20px;
        }
        .stat-value.red {
            background-color: #ef5350;
            color: #ffffff;
            padding: 4px 8px;
            border-radius: 3px;
            min-height: 20px;
            line-height: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        ${generateProfileCard(characterImageCache, p1, p2, true)}
        ${generateProfileCard(characterImageCache, p2, p1, false)}
    </div>
</body>
</html>`;
  }

export   function generateProfileCard(
    characterImageCache: Map<string, string>,
    player: SwgohGgFullPlayerResponse,
    otherPlayer: SwgohGgFullPlayerResponse,
    isPlayer1: boolean
  ): string {
    const fAC = (ac: number) =>
      `${ac.toString().slice(0, 3)}-${ac.toString().slice(3, 6)}-${ac.toString().slice(6)}`;

    const modStats = calculateModStats(player);
    const otherModStats = calculateModStats(otherPlayer);

    return `
        <div class="profile-card">
            <div class="header">${escapeHtml(player.data.name)}</div>
            
            <div class="section">Profile</div>
            <div class="content-row">
                <div class="label">Ally Code</div>
                <div class="value">${fAC(player.data.ally_code)}</div>
            </div>
            <div class="content-row dark">
                <div class="label">Guild</div>
                <div class="value">${escapeHtml(player.data.guild_name || 'N/A')}</div>
            </div>

            <div class="section">GAC Stats</div>
            <div class="stats-grid">
                <div class="stat-cell">
                    <div class="gac-stat-label">Offense Wins</div>
                    <div class="gac-stat-value">${player.data.season_offensive_battles_won ?? 0}</div>
                </div>
                <div class="stat-cell">
                    <div class="gac-stat-label">Under</div>
                    <div class="gac-stat-value">${player.data.season_undersized_squad_wins ?? 0}</div>
                </div>
                <div class="stat-cell">
                    <div class="gac-stat-label">Defense Wins</div>
                    <div class="gac-stat-value">${player.data.season_successful_defends ?? 0}</div>
                </div>
                <div class="stat-cell">
                    <div class="gac-stat-label">Clears</div>
                    <div class="gac-stat-value">${player.data.season_full_clears ?? 0}</div>
                </div>
            </div>

            <div class="section">Summary</div>
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="summary-label">GP</div>
                    <div class="summary-value">${fmt(player.data.galactic_power)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Character GP</div>
                    <div class="summary-value">${fmt(player.data.character_galactic_power)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Ship GP</div>
                    <div class="summary-value">${fmt(player.data.ship_galactic_power)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Arena Rank</div>
                    <div class="summary-value">${player.data.arena_rank || 'N/A'}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Fleet Rank</div>
                    <div class="summary-value">${player.data.fleet_arena?.rank || 'N/A'}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Zetas</div>
                    <div class="summary-value">${countZetas(player)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Omicrons</div>
                    <div class="summary-value">${countOmicrons(player)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">G13</div>
                    <div class="summary-value">${countGearLevel(player, 13)}</div>
                </div>
            </div>

                    <div class="section">Mod Analysis</div>
                    <div class="mod-analysis">
                        ${generateModAnalysisRow('S 25+', modStats.speed25Plus, otherModStats.speed25Plus, isPlayer1)}
                        ${generateModAnalysisRow('S 20-24', modStats.speed20to24, otherModStats.speed20to24, isPlayer1)}
                        ${generateModAnalysisRow('S 15-19', modStats.speed15to19, otherModStats.speed15to19, isPlayer1)}
                        ${generateModAnalysisRow('S 10-14', modStats.speed10to14, otherModStats.speed10to14, isPlayer1)}
                        ${generateModAnalysisRow('6-Dot Mods', modStats.sixDot, otherModStats.sixDot, isPlayer1)}
                    </div>

            <div class="section">GALACTIC LEGENDS</div>
            <div class="legends-section">
                ${generateGalacticLegends(characterImageCache, player, otherPlayer, isPlayer1)}
            </div>
        </div>`;
  }

export   function generateModAnalysisRow(label: string, value: number, otherValue: number, isPlayer1: boolean): string {
    // Player 1: green if better, white (no class) if worse
    // Player 2: red if better, white (no class) if worse
    const colorClass = value > otherValue 
      ? (isPlayer1 ? 'green' : 'red')
      : value < otherValue 
      ? '' // white (no class) when worse
      : ''; // equal, no color
    return `
                        <div class="mod-cell">${label}</div>
                        <div class="mod-cell ${colorClass}">${value}</div>`;
  }

export   function generateGalacticLegends(
    characterImageCache: Map<string, string>,
    player: SwgohGgFullPlayerResponse,
    otherPlayer: SwgohGgFullPlayerResponse,
    isPlayer1: boolean
  ): string {
    const glMap = new Map<string, SwgohGgUnit>();
    const otherGlMap = new Map<string, SwgohGgUnit>();
    
    for (const u of player.units) {
      // Use our authoritative GL list OR the API flag
      if (GALACTIC_LEGEND_IDS.includes(u.data.base_id) || u.data.is_galactic_legend) {
        glMap.set(u.data.base_id, u);
      }
    }
    
    for (const u of otherPlayer.units) {
      // Use our authoritative GL list OR the API flag
      if (GALACTIC_LEGEND_IDS.includes(u.data.base_id) || u.data.is_galactic_legend) {
        otherGlMap.set(u.data.base_id, u);
      }
    }

    const speedIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA4ElEQVQ4jc2SsQ3CMBRF/7cZgIqGhgFYgJKGkoINqGhoqBiACRiABShp2IANKCkoGIC/RYoUKXZiQKLhNU7O9bU/n5Ox+3sxBiIyBdAB0AUwAtAAsAPwKCJv50R+4B64BzCpFxC8AfgNggxAL4dKqV4ZM5fJXJXJKoNO3cEygGQNwH7TRXb9CrIDT5+wvt9kSCnlqc3gmgkAKK0EIK8A4JpScqeqAhhaaw4hTDLGPFp0TgHsjDF2GWMurWwdg0spP0Z2HdxcOGD/4wBV7wIAr2PMpZbLRmZV7wJBEATBQ+AD0iZBQXRqp1YAAAAASUVORK5CYII=';
    const healthIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA2klEQVQ4jc2SMQrCQBRE3/wNFrGwsLCxsfEAnsALeAIPYGNjY2djYWFhYePCb9xCWMhP4gp24IOBZf7M7C5J+HdpAg4lcvXYt4ArUIQTrp8t4O5CJxDANezfPqkZngAOLlSH8BWYu9BpvJAaOoB5g4b5eo8fBHbu6tpDLgAAAABJRU5ErkJggg==';
    const protectionIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA00lEQVQ4jc2SwQ3CIBSG/9cZXMARHMENHMENHMERHEE3cARHcAQ3YARHcATdQF9jGkMpFKI38CXk8Xjf4xH+XepAVdcA1gC2ACYAHgDuAI4icvfOxB8oRXV/KiB5A/DTBDmAWQhFKTUN2WhkmUvFKoJJ3cE4gGQFwPHQRw79DrIDz5+wvh9kSKfTqcrg2gkAuFYCUK4A4OY0la2qCoChMYbD8/woo+wMwI8xhpZS0q6VzWNwl8vnkd0Ht1cPqL8cIOtNAODVWnuq5bKRWdW7QBCEQfAC+wZEE29CkGEAAAAASUVORK5CYII=';
    const tenacityIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABJElEQVQ4jc2RsUoDQRCG/5ndO7AQBAtBsLCxsfEBfAIfwAfQxsbGzsbCwsLCxoS9xEYQJHeSO0gKfQAfwAfQxsbGzsbCYmGxceF2bALhQi6JBvzhmGX++WdmCP8uNYCIDADsAtgBMAZwBnAG4KSu6+m6Sk+gqhpjvGBmFpERgA2AHYBpCGFczgkhDBqNxjDG+O4cx1UK1A2INxvxEMBBXdfH5RoRaabT6YQx5gVj7JeJrgI4NsYMGGP2yrlQKLSz2azDGHMRQnjYINdlAN1er9cNIbwppbyMoijt9/tDlVIaABOl1NPe3l5XKZWGECZSynMAJ1JKvb+/f5kxZpzIllK+1e/3ryul7jLG/Nr6O4A/6/L9DwxAqKr67dv/k25/HCDYpvPxFYBPX4xJbfQ9JWUAAAAASUVORK5CYII=';
    const potencyIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA70lEQVQ4jc2SMQ6CQBBF/8wuFhQWFBYWFhYewBN4AQ9gY2NjZ2NhYWFhY8LOYiMIEvYAHsAL2NjY2NlYWCwsFs7OWAgEAokW/mYyM/tn5s+Q/l0aQETGAHYB7ACMARwDOAZwVFXV5bpKj6CqGmO8Y2YWEREB2ACwA3BclmXTOI7juq6/nPM0heIGhPeNOABwUFXVYblGRJppmmbM7MIY86uJLgI4NMb0GWN2yzlPKLTz+bzNGHMeQrjbINdFAK1ut9sKIdxLKc/CMEy63e6QSymNiAyllE97e3stkUojIjMp5TGAQyml3t/fv8wYM46k/r+B/wPwDhMzgFUAAAAASUVORK5CYII=';

    // GL name mapping for display
    const glNames: Record<string, string> = {
      'GLREY': 'Rey',
      'SUPREMELEADERKYLOREN': 'Supreme Leader Kylo Ren',
      'GRANDMASTERLUKE': 'Jedi Master Luke',
      'SITHPALPATINE': 'Sith Eternal Emperor',
      'JEDIMASTERKENOBI': 'Jedi Master Kenobi',
      'LORDVADER': 'Lord Vader',
      'JABBATHEHUTT': 'Jabba the Hutt',
      'GLLEIA': 'Leia Organa',
      'GLAHSOKATANO': 'Ahsoka Tano',
      'GLHONDO': 'Hondo Ohnaka'
    };

    let html = '';
    let hasAnyGL = false;

    // Iterate through ALL GLs - show both owned and not owned to ensure alignment
    for (const glId of GALACTIC_LEGEND_IDS) {
      const gl = glMap.get(glId);
      const otherGl = otherGlMap.get(glId);
      
      // Skip if neither player has this GL
      if (!gl && !otherGl) continue;
      
      hasAnyGL = true;

      // Get character image from cache
      const charImage = characterImageCache.get(glId) || '';
      const glName = glNames[glId] || glId;

      // If this player doesn't have the GL, show "Not Owned" placeholder
      if (!gl) {
        const iconHtml = charImage 
          ? `<img src="${charImage}" alt="${glName}" style="opacity: 0.4; filter: grayscale(100%);" />`
          : `<div style="width: 70px; height: 70px; background: #4a4a4a; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #f5deb3; font-size: 10px; opacity: 0.4;">GL</div>`;
        
        html += `
                <div class="legend-item">
                    <div class="legend-table">
                        <div class="legend-image-cell">${iconHtml}</div>
                        <div class="legend-table-cell stat-label-cell">
                            <span>Relic</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${speedIconBase64}" alt="speed" style="opacity: 0.4;">
                            <span>Speed</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${healthIconBase64}" alt="health" style="opacity: 0.4;">
                            <span>Health</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${protectionIconBase64}" alt="protection" style="opacity: 0.4;">
                            <span>Protection</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${potencyIconBase64}" alt="potency" style="opacity: 0.4;">
                            <span>Potency</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${tenacityIconBase64}" alt="tenacity" style="opacity: 0.4;">
                            <span>Tenacity</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell" style="color: #888;">—</div>
                    </div>
                </div>`;
        continue;
      }

      const stats = getGLStats(gl);
      const otherStats = otherGl ? getGLStats(otherGl) : null;

      // Get relic levels using the same logic as strategy service
      let relicLevel: number | null = null;
      if (gl.data.gear_level >= 13 && gl.data.relic_tier !== null && gl.data.relic_tier !== undefined) {
        relicLevel = Math.max(0, gl.data.relic_tier - 2);
      }
      
      let otherRelicLevel: number | null = null;
      if (otherGl && otherGl.data.gear_level >= 13 && otherGl.data.relic_tier !== null && otherGl.data.relic_tier !== undefined) {
        otherRelicLevel = Math.max(0, otherGl.data.relic_tier - 2);
      }

      // Determine colors - if other player doesn't have GL, this player is better (green/red)
      const relicColor = !otherGl 
        ? (isPlayer1 ? 'green' : 'red')
        : ((relicLevel ?? 0) > (otherRelicLevel ?? 0)
            ? (isPlayer1 ? 'green' : 'red')
            : (relicLevel ?? 0) < (otherRelicLevel ?? 0)
            ? '' : '');
      const speedColor = !otherStats 
        ? (isPlayer1 ? 'green' : 'red')
        : (stats.speed.total > otherStats.speed.total 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.speed.total < otherStats.speed.total ? '' : '');
      const healthColor = !otherStats 
        ? (isPlayer1 ? 'green' : 'red')
        : (stats.health > otherStats.health 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.health < otherStats.health ? '' : '');
      const protectionColor = !otherStats 
        ? (isPlayer1 ? 'green' : 'red')
        : (stats.protection > otherStats.protection 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.protection < otherStats.protection ? '' : '');
      const tenacityColor = !otherStats 
        ? (isPlayer1 ? 'green' : 'red')
        : (stats.tenacity > otherStats.tenacity 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.tenacity < otherStats.tenacity ? '' : '');
      const potencyColor = !otherStats 
        ? (isPlayer1 ? 'green' : 'red')
        : (stats.potency > otherStats.potency 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.potency < otherStats.potency ? '' : '');

      const iconHtml = charImage 
        ? `<img src="${charImage}" alt="${gl.data.name}" />`
        : '<div style="width: 70px; height: 70px; background: #4a4a4a; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #f5deb3; font-size: 10px;">GL</div>';

      const relicDisplay = relicLevel !== null ? `R${relicLevel}` : 'None';

      html += `
                <div class="legend-item">
                    <div class="legend-table">
                        <div class="legend-image-cell">${iconHtml}</div>
                        <div class="legend-table-cell stat-label-cell">
                            <span>Relic</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${relicColor}">${relicDisplay}</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${speedIconBase64}" alt="speed">
                            <span>Speed</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${speedColor}">${stats.speed.total} (+${stats.speed.bonus})</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${healthIconBase64}" alt="health">
                            <span>Health</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${healthColor}">${stats.health.toFixed(2)}K</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${protectionIconBase64}" alt="protection">
                            <span>Protection</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${protectionColor}">${stats.protection.toFixed(2)}K</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${potencyIconBase64}" alt="potency">
                            <span>Potency</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${potencyColor}">${stats.potency}</div>
                        <div class="legend-table-cell stat-label-cell">
                            <img class="legend-stat-icon" src="${tenacityIconBase64}" alt="tenacity">
                            <span>Tenacity</span>
                        </div>
                        <div class="legend-table-cell stat-value-cell ${tenacityColor}">${stats.tenacity}</div>
                    </div>
                </div>`;
    }

    return hasAnyGL ? html : '<div class="legend-item">No Galactic Legends</div>';
  }
