import puppeteer, { Browser, Page } from 'puppeteer';
import { SwgohGgFullPlayerResponse, SwgohGgUnit } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';

// Galactic Legend base IDs in display order
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

export class PlayerComparisonService {
  private browser: Browser | null = null;
  private characterImageCache: Map<string, string> = new Map();

  constructor() {
    // Browser will be created on demand
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
    }
    return this.browser;
  }

  private async fetchCharacterImages(): Promise<Map<string, string>> {
    // Return cached data if available
    if (this.characterImageCache.size > 0) {
      return this.characterImageCache;
    }

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Set a realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      const url = 'https://swgoh.gg/api/characters/';
      
      // Intercept network requests to get the JSON response directly (MUST be before goto)
      let jsonResponse: any = null;
      let responseCaptured = false;

      page.on('response', async (response) => {
        const responseUrl = response.url();
        if (responseUrl === url || responseUrl.includes('/api/characters/')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              jsonResponse = await response.json();
              responseCaptured = true;
            } catch (e) {
              logger.warn(`Could not parse JSON from characters API: ${e}`);
            }
          }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check for Cloudflare challenge
      const content = await page.content();
      if (content.includes('Just a moment...') || content.includes('Enable JavaScript and cookies to continue')) {
        // Wait for Cloudflare to resolve
        await page.waitForSelector('body:not(.no-js)', { timeout: 60000 }).catch(() => {
          logger.warn('Cloudflare challenge might be stuck or resolved unexpectedly.');
        });
        // Try again after challenge
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      }

      // Wait a bit for response to be captured if not already
      if (!responseCaptured) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Use intercepted response
      let characters: any[] = [];
      if (jsonResponse) {
        if (Array.isArray(jsonResponse)) {
          characters = jsonResponse;
        } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
          characters = jsonResponse.data;
        }
      }

      if (characters.length === 0) {
        logger.warn('No character data retrieved from API, images will not be displayed');
      }

      // Map base_id to image URL for Galactic Legends
      for (const char of characters) {
        if (char && char.base_id && GALACTIC_LEGEND_IDS.includes(char.base_id) && char.image) {
          this.characterImageCache.set(char.base_id, char.image);
        }
      }

      logger.info(`Fetched ${this.characterImageCache.size} Galactic Legend character images`);
      return this.characterImageCache;
    } catch (error) {
      logger.error('Error fetching character images:', error);
      return this.characterImageCache; // Return empty cache on error
    } finally {
      await page.close();
    }
  }

  async generateComparisonImage(
    p1: SwgohGgFullPlayerResponse,
    p2: SwgohGgFullPlayerResponse
  ): Promise<Buffer> {
    // Fetch character images before generating HTML
    await this.fetchCharacterImages();

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Set initial viewport to ensure side-by-side layout
      await page.setViewport({
        width: 1000,
        height: 600, // Initial height, will be expanded by fullPage
        deviceScaleFactor: 2
      });

      // Generate HTML
      const html = this.generateHTML(p1, p2);

      // Set content and wait for rendering
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Take screenshot with fullPage to capture everything dynamically
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }

  private generateHTML(
    p1: SwgohGgFullPlayerResponse,
    p2: SwgohGgFullPlayerResponse
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
        ${this.generateProfileCard(p1, p2, true)}
        ${this.generateProfileCard(p2, p1, false)}
    </div>
</body>
</html>`;
  }

  private generateProfileCard(
    player: SwgohGgFullPlayerResponse,
    otherPlayer: SwgohGgFullPlayerResponse,
    isPlayer1: boolean
  ): string {
    const fAC = (ac: number) =>
      `${ac.toString().slice(0, 3)}-${ac.toString().slice(3, 6)}-${ac.toString().slice(6)}`;

    const modStats = this.calculateModStats(player);
    const otherModStats = this.calculateModStats(otherPlayer);

    return `
        <div class="profile-card">
            <div class="header">${this.escapeHtml(player.data.name)}</div>
            
            <div class="section">Profile</div>
            <div class="content-row">
                <div class="label">Ally Code</div>
                <div class="value">${fAC(player.data.ally_code)}</div>
            </div>
            <div class="content-row dark">
                <div class="label">Guild</div>
                <div class="value">${this.escapeHtml(player.data.guild_name || 'N/A')}</div>
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
                    <div class="summary-value">${this.fmt(player.data.galactic_power)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Character GP</div>
                    <div class="summary-value">${this.fmt(player.data.character_galactic_power)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Ship GP</div>
                    <div class="summary-value">${this.fmt(player.data.ship_galactic_power)}</div>
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
                    <div class="summary-value">${this.countZetas(player)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Omicrons</div>
                    <div class="summary-value">${this.countOmicrons(player)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">G13</div>
                    <div class="summary-value">${this.countGearLevel(player, 13)}</div>
                </div>
            </div>

                    <div class="section">Mod Analysis</div>
                    <div class="mod-analysis">
                        ${this.generateModAnalysisRow('S 25+', modStats.speed25Plus, otherModStats.speed25Plus, isPlayer1)}
                        ${this.generateModAnalysisRow('S 20-24', modStats.speed20to24, otherModStats.speed20to24, isPlayer1)}
                        ${this.generateModAnalysisRow('S 15-19', modStats.speed15to19, otherModStats.speed15to19, isPlayer1)}
                        ${this.generateModAnalysisRow('S 10-14', modStats.speed10to14, otherModStats.speed10to14, isPlayer1)}
                        ${this.generateModAnalysisRow('6-Dot Mods', modStats.sixDot, otherModStats.sixDot, isPlayer1)}
                    </div>

            <div class="section">GALACTIC LEGENDS</div>
            <div class="legends-section">
                ${this.generateGalacticLegends(player, otherPlayer, isPlayer1)}
            </div>
        </div>`;
  }

  private generateModAnalysisRow(label: string, value: number, otherValue: number, isPlayer1: boolean): string {
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

  private generateGalacticLegends(
    player: SwgohGgFullPlayerResponse,
    otherPlayer: SwgohGgFullPlayerResponse,
    isPlayer1: boolean
  ): string {
    const glMap = new Map<string, SwgohGgUnit>();
    const otherGlMap = new Map<string, SwgohGgUnit>();
    
    for (const u of player.units) {
      if (u.data.is_galactic_legend && GALACTIC_LEGEND_IDS.includes(u.data.base_id)) {
        glMap.set(u.data.base_id, u);
      }
    }
    
    for (const u of otherPlayer.units) {
      if (u.data.is_galactic_legend && GALACTIC_LEGEND_IDS.includes(u.data.base_id)) {
        otherGlMap.set(u.data.base_id, u);
      }
    }

    const speedIconBase64 = 'data:image/webp;base64,UklGRh4CAABXRUJQVlA4TBICAAAvH8AHEJVAbCRJkbT+Ox0PvbP3YEA9Qx1ESAIAsIykrm3b9v5s27Zt27Zt27Zt28b51pmAvKIQYCJCg50EY77S1Bhz7EIRuiW4BBhxE6dU49W2O/+AfbOIVuARYcFPsjpDFmx66irnlREsVFT40WKlwJqf+UnuoUS4R2XkESTUJ/4JauhLUPG5bmtPOlmU2h85whTsTrVRSKDhpMJGgFwNuo04AUYfRhW59uxAB8FEKVBRCVQcVNnwl6/H7Gfrtx1fbevTf5cysSVEvQIOUWcXDDRVrTAoVBV7bVvf3jxopKa3/c8iOvt1hiC5+vVo1znGFcg4uFFMoqqjj0FyDoJDiYv92+CFDnPD/gGese1Ax0ntIluzaadefXRWvkEBh0ec8OzCJcFeiHK9Zm0492vyh8gGnRQ2CjzaJrX/p0lQuR38J7BBJwQLDSEa7KqAUV0OwiXKkp9sNQZsuPMfGL3gO0SSMR+Fuiw68OB70r1Bx/+RJTARUfE4XZViOYLBg5+ScSQifQP1y7+29cgT7pocoPVbLhNHrXfWNC32sQkKSxeV/re9tVUNcYOQ8HLVtl7V4F0IRGbOb0DbT3QblASLQp9AW7eCYO4lZ0b6HAFlskEzKQNe29YS5YUkCAWIzSK9M9BWzFoClTC1Pw48RMhSol6jcmtAawXuGhjoqAnSZMqBtzDp6nQbsWI19lzR3qBXEQ==';
    const healthIconBase64 = 'data:image/webp;base64,UklGRswAAABXRUJQVlA4TMAAAAAvH8AHEIXjRpIUqfx3Opau4egdATXbtmXZg7tFG8CzL8BBsi8yxHuQiFQGcKju0ojMQHJ3T/x6T0Doi1rBs9Q/QEhHR0dHucEHAGDwzcRr7i/9Ffj9gpOZmcILaEsxe4IuWajYUzIBBYLQhn+QCNV74G1YHCq/h1pV0y+Au3OrLAkA8nA3Co2KAgDGscDpA4CFFpjsAbDQFJmsrKwxABYao4E7FlqyCr2T3JKJYKhLhMPhcAIvPMSIQ5tsivShrwo=';
    const protectionIconBase64 = 'data:image/webp;base64,UklGRsYAAABXRUJQVlA4TLoAAAAvH8AHEFU4bhvJkTb/pHm2u8++a3Yi3AYAQDbRpguSKaNHfGFfkDMwp1y78gGvbj/gAbYxAfmxBI2T+Aqkkq//mYWaQkjczofZiAmI0Nq/uIWrRTXzb4ZaI+mdg/qkiqn/aCq6M6koz6QimhFXuDOpYGd2BWQ3YQ+qRH1ipyyYWDWoc29Da1HsKaaJ9upkdSLtyBxAG2FVy+6F7FlZlEzSfJ6tnVm6yyMXeqYxJncrBzAPYuobZB/Afwk=';
    const tenacityIconBase64 = 'data:image/webp;base64,UklGRsABAABXRUJQVlA4TLQBAAAvH8AHEJVIbCPJkaT132me7Jn7fwPqVd9i4kSEJAAAy0iybdu2bdu2nrZt27Zt79m2fWM7EzC/UBHOtPN7Gy+BfEDPm+Z5XIPqi0yo7gs/y15wKFjkh5BMUqzO8QjI4viE9u7fmM0y62MksI9IP7izA8BTOAhl45hdP0XNjOIKxxVEXIS6ordGHqH8kEdmKDqzPl6iAk4/wQGXa9JCruCNEJ/hFUyM2Zb9NVO58SwoxDI6VkLxYhyWwCXMPgGmR1MVGlUPSwgBIG9nmRUAl/ShKV6uBHp/SOoGIWYBSMaa2q6UDd55XQv4O5Y1LwJFEm0o7ThudL/v3MnPzOCiwWzJQGD++R9Cvgr7dDt4b53qkkjf3hpm74C/cOAg/pdRrPp60ZtZpx3CN+je35Apphv43mCZOTCygtjP08yla2//U3VknALfe+/vjHHs2iDgCTpEtvt1XSWUdoh/QXKA+dB8dEHAWWUwI8tnmHzHdqM7TggMCdZvNZJN2jHuA2o0b3RnegmA+NdzmKTMmRg8b7/8H43cKePpa3c46ud4/BrSH7LneAm8Dk/kHBuQvrwM5SmOc35W';
    const potencyIconBase64 = 'data:image/webp;base64,UklGRi4BAABXRUJQVlA4TCEBAAAvH8AHEDVAbiPJkdT+O80TPV3TJ/6ZEW5ra28TVbbJoc5hiQyttQd5AeQJoMOroJLcuiT3SpXDBHyK3LZt5FOS7jqfyCAuHe4iV6KhuaNt/zBKVvg3uJXSOziYGB4S86ReoOEJdTb7xswZGo0RFaK+JttCzCIx8QVCZaoKwF1+kQRlyCySyLmBQOqMDfgpnM9RX8COKEv89ad76lWifMIaHOd3KlifcADTDRZfKOJ3wxTwh1Ng0+YXe2hrO5yG7kP5QvhNFklOpznAvIRBu0PmGdglOZ1mHCI6DrlfaPgXvQnd4V+Cgc/dv0bKA9zkTn0j51bPyXo61NNX2XxF6ozvoOkJdTSFtnE8+HIo8i59nUTJeu+LKP3XvszeN3egJTMQAA==';

    let html = '';
    for (const glId of GALACTIC_LEGEND_IDS) {
      const gl = glMap.get(glId);
      if (!gl) continue;

      const stats = this.getGLStats(gl);
      const otherGl = otherGlMap.get(glId);
      const otherStats = otherGl ? this.getGLStats(otherGl) : null;

      // Get relic levels using the same logic as strategy service
      // Relic level calculation: if gear_level >= 13 and relic_tier exists, then relic_level = relic_tier - 2
      // Note: If gear_level <= 12, relic_tier may still be 1, but the unit is not reliced
      let relicLevel: number | null = null;
      if (gl.data.gear_level >= 13 && gl.data.relic_tier !== null && gl.data.relic_tier !== undefined) {
        // Actual relic level is relic_tier - 2
        relicLevel = Math.max(0, gl.data.relic_tier - 2);
      }
      
      let otherRelicLevel: number | null = null;
      if (otherGl && otherGl.data.gear_level >= 13 && otherGl.data.relic_tier !== null && otherGl.data.relic_tier !== undefined) {
        // Actual relic level is relic_tier - 2
        otherRelicLevel = Math.max(0, otherGl.data.relic_tier - 2);
      }

      // Determine color based on comparison:
      // - Player 1 (left): Green if better than Player 2, white (no class) if worse
      // - Player 2 (right): Red if better than Player 1, white (no class) if worse
      // - No color class (default white) if equal or other player doesn't have the GL
      // Note: For relic, higher is better. null is treated as 0.
      const relicColor = otherRelicLevel !== null || relicLevel !== null
        ? ((relicLevel ?? 0) > (otherRelicLevel ?? 0)
            ? (isPlayer1 ? 'green' : 'red')
            : (relicLevel ?? 0) < (otherRelicLevel ?? 0)
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';
      const speedColor = otherStats 
        ? (stats.speed.total > otherStats.speed.total 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.speed.total < otherStats.speed.total 
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';
      const healthColor = otherStats 
        ? (stats.health > otherStats.health 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.health < otherStats.health 
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';
      const protectionColor = otherStats 
        ? (stats.protection > otherStats.protection 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.protection < otherStats.protection 
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';
      const tenacityColor = otherStats 
        ? (stats.tenacity > otherStats.tenacity 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.tenacity < otherStats.tenacity 
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';
      const potencyColor = otherStats 
        ? (stats.potency > otherStats.potency 
            ? (isPlayer1 ? 'green' : 'red')
            : stats.potency < otherStats.potency 
            ? '' // white (no class) when worse
            : '') // equal, no color
        : '';

      const charImage = this.characterImageCache.get(glId) || '';
      const iconHtml = charImage 
        ? `<img src="${charImage}" alt="${gl.data.name}" />`
        : '<div style="width: 70px; height: 70px; background: #4a4a4a; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #f5deb3; font-size: 10px;">GL</div>';

      // Format relic level display (R0-R10, or "None" if null)
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

    return html || '<div class="legend-item">No Galactic Legends</div>';
  }

  private getGLStats(u: SwgohGgUnit) {
    const s = u.data.stats;
    const d = u.data.stat_diffs || {};

    const speed = Math.round(s['5'] || 0);
    const speedBonus = Math.round(d['5'] || 0);

    const health = (s['1'] || 0) / 1000; // Keep as decimal for formatting
    const protection = (s['28'] || 0) / 1000; // Keep as decimal for formatting
    const offense = Math.round(s['6'] || 0);
    const potency = Math.round((s['17'] || 0) * 100); // Potency as percentage
    const tenacity = Math.round((s['18'] || 0) * 100); // Tenacity as percentage

    return {
      speed: { total: speed, bonus: speedBonus },
      health,
      protection,
      offense,
      potency,
      tenacity
    };
  }

  private fmt(num: number | undefined | null): string {
    if (!num) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return String(num);
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  private countZetas(player: SwgohGgFullPlayerResponse): number {
    return player.units.reduce((sum, unit) => sum + unit.data.zeta_abilities.length, 0);
  }

  private countOmicrons(player: SwgohGgFullPlayerResponse): number {
    return player.units.reduce((sum, unit) => sum + unit.data.omicron_abilities.length, 0);
  }

  private countGearLevel(player: SwgohGgFullPlayerResponse, level: number): number {
    return player.units.filter(u => u.data.gear_level === level).length;
  }

  private calculateModStats(player: SwgohGgFullPlayerResponse): {
    speed25Plus: number;
    sixDot: number;
    speed20to24: number;
    speed20Plus: number;
    speed15to19: number;
    speed15Plus: number;
    speed10to14: number;
    speed10Plus: number;
  } {
    // Mods are at the root level, not inside data
    const mods = player.mods || [];
    
    // Safety check: if mods array is empty, return zeros
    if (!mods || mods.length === 0) {
      return {
        speed25Plus: 0,
        sixDot: 0,
        speed20to24: 0,
        speed20Plus: 0,
        speed15to19: 0,
        speed15Plus: 0,
        speed10to14: 0,
        speed10Plus: 0
      };
    }
    
    let speed25Plus = 0;
    let sixDot = 0;
    let speed20to24 = 0;
    let speed20Plus = 0;
    let speed15to19 = 0;
    let speed15Plus = 0;
    let speed10to14 = 0;
    let speed10Plus = 0;

    for (const mod of mods) {
      // Check if 6-dot mod (tier 5 and level 15)
      if (mod.tier === 5 && mod.level === 15) {
        sixDot++;
      }

      // Find Speed secondary stat (not primary - we only count secondary stats)
      let speedValue = 0;
      if (mod.secondary_stats && Array.isArray(mod.secondary_stats)) {
        for (const secStat of mod.secondary_stats) {
          // Check by stat_id first (more reliable), then verify name if available
          if (secStat.stat_id === 5) {
            // Verify it's Speed by checking name if available (or if name is missing, assume it's Speed)
            if (!secStat.name || secStat.name === 'Speed' || secStat.name.toLowerCase() === 'speed') {
              // Use display_value if available, otherwise calculate from value
              if (secStat.display_value !== undefined && secStat.display_value !== null) {
                // Parse the display value (e.g., "26", "26.5", or could be a number)
                if (typeof secStat.display_value === 'string') {
                  const cleaned = secStat.display_value.replace(/,/g, '').trim();
                  speedValue = parseFloat(cleaned) || 0;
                } else if (typeof secStat.display_value === 'number') {
                  speedValue = secStat.display_value;
                }
              } else if (secStat.value !== undefined && secStat.value !== null) {
                // Fallback: calculate from value (value is in thousands, e.g., 70000 = 7, 260000 = 26)
                speedValue = secStat.value / 10000;
              }
              
              // Only count one speed secondary per mod
              if (speedValue > 0) {
                break;
              }
            }
          }
        }
      }

      // Categorize by speed value (only count mods with speed >= 10)
      if (speedValue >= 25) {
        speed25Plus++;
        speed20Plus++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 20) {
        speed20to24++;
        speed20Plus++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 15) {
        speed15to19++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 10) {
        speed10to14++;
        speed10Plus++;
      }
    }

    return {
      speed25Plus,
      sixDot,
      speed20to24,
      speed20Plus,
      speed15to19,
      speed15Plus,
      speed10to14,
      speed10Plus
    };
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('PlayerComparisonService browser closed.');
    }
  }
}
