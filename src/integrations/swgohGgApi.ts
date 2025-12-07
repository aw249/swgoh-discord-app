import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/requestQueue';
import { counterCache } from '../storage/counterCache';
import { defenseSquadCache } from '../storage/defenseSquadCache';

export interface GacBracketPlayer {
  ally_code: number;
  player_level: number;
  player_name: string;
  player_skill_rating: number | null;
  player_gp: number;
  guild_id: string;
  guild_name: string;
  bracket_rank: number;
  bracket_score: number;
}

export interface GacBracketData {
  start_time: string;
  league: string;
  season_id: string;
  season_number: number;
  event_id: string;
  bracket_id: number;
  bracket_players: GacBracketPlayer[];
}

export interface GacBracketResponse {
  data: GacBracketData;
  message: string | null;
  total_count: number | null;
}

export interface SwgohGgPlayerData {
  ally_code: number;
  name: string;
  level: number;
  galactic_power: number;
  character_galactic_power: number;
  ship_galactic_power: number;
  skill_rating: number;
  league_name: string;
  guild_name: string;
  last_updated: string;
  arena_rank?: number;
  arena_leader_base_id?: string;
  fleet_arena?: {
    rank: number;
    leader: string;
  };
  guild_id?: string;
  season_full_clears?: number;
  season_successful_defends?: number;
  season_offensive_battles_won?: number;
  season_undersized_squad_wins?: number;
}

export interface SwgohGgUnitStats {
  '1'?: number; // Health
  '2'?: number;
  '3'?: number;
  '4'?: number;
  '5'?: number; // Speed
  '6'?: number; // Physical Damage
  '7'?: number; // Special Damage
  '8'?: number; // Armor
  '9'?: number;
  '10'?: number; // Armor Penetration
  '11'?: number;
  '12'?: number;
  '13'?: number;
  '14'?: number; // Physical Crit Chance
  '15'?: number; // Special Crit Chance
  '16'?: number; // Crit Damage
  '17'?: number; // Potency
  '18'?: number; // Tenacity
  '27'?: number; // Health Steal
  '28'?: number; // Protection
}

export interface SwgohGgUnitStatDiffs {
  '1'?: number; // Health diff
  '5'?: number; // Speed diff (bonus from mods)
  '6'?: number; // Physical Damage diff
  '7'?: number; // Special Damage diff
  '8'?: number; // Armor diff
  '9'?: number;
  '17'?: number; // Potency diff
  '18'?: number; // Tenacity diff
  '28'?: number; // Protection diff
}

export interface SwgohGgUnit {
  data: {
    base_id: string;
    name: string;
    gear_level: number;
    level: number;
    power: number;
    rarity: number;
    stats: SwgohGgUnitStats;
    stat_diffs?: SwgohGgUnitStatDiffs;
    relic_tier: number | null;
    is_galactic_legend: boolean;
    combat_type: number; // 1 = character, 2 = ship
    mod_set_ids: string[];
    zeta_abilities: string[];
    omicron_abilities: string[];
  };
}

export interface SwgohGgMod {
  id: string;
  level: number;
  tier: number;
  rarity: number;
  set: string;
  slot: number;
  primary_stat?: {
    name: string;
    stat_id: number;
    value: number;
    display_value: string;
  };
  secondary_stats?: Array<{
    name: string;
    stat_id: number;
    value: number;
    display_value: string;
    roll?: number;
  }>;
  character?: string;
  reroll_count?: number;
}

export interface SwgohGgFullPlayerResponse {
  data: SwgohGgPlayerData;
  units: SwgohGgUnit[];
  mods?: SwgohGgMod[];
}

export interface GacDefensiveSquadUnit {
  baseId: string;
  relicLevel: number | null;
  portraitUrl: string | null;
}

export interface GacDefensiveSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
}

export interface GacCounterSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
  winPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
}

export interface GacTopDefenseSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
}

// Shared queue for swgoh.gg HTTP / Puppeteer work so that multiple
// Discord commands do not spawn many concurrent heavy browser tasks.
// Start conservatively with a single concurrent task; this can be
// made configurable later if needed.
const swgohGgRequestQueue = new RequestQueue({ maxConcurrency: 1 });

export class SwgohGgApiClient {
  private readonly baseUrl = 'https://swgoh.gg/api';
  private browser: Browser | null = null;

  constructor() {
    // Puppeteer will handle Cloudflare challenges via headless browser
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
    }
    return this.browser;
  }

  /**
   * Internal implementation for fetching JSON from swgoh.gg via Puppeteer.
   * This should not be called directly; use fetchWithPuppeteer so that
   * calls are queued and concurrency-limited.
   */
  private async fetchWithPuppeteerInternal(url: string): Promise<any> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Set a realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Intercept network responses to capture the JSON response
      let jsonResponse: any = null;
      let responseCaptured = false;

      page.on('response', async (response) => {
        const responseUrl = response.url();
        if (responseUrl === url || responseUrl.includes('/api/player/')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              jsonResponse = await response.json();
              responseCaptured = true;
            } catch (error) {
              // Not JSON, ignore
            }
          }
        }
      });

      // Navigate to the URL and wait for network to be idle (Cloudflare challenge should complete)
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait a bit for Cloudflare challenge to complete if needed
      if (!responseCaptured) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Try navigating again if we didn't get the response
        if (!responseCaptured) {
          const response = await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });

          if (response) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              jsonResponse = await response.json();
              responseCaptured = true;
            }
          }
        }
      }

      // If we captured the JSON response, return it
      if (responseCaptured && jsonResponse) {
        return jsonResponse;
      }

      // Fallback: try to extract JSON from page content
      const content = await page.evaluate(() => {
        // Check if the page body contains JSON
        // @ts-ignore - document is available in browser context
        const bodyText = document.body.textContent || '';
        // Try to find JSON in the page
        const jsonMatch = bodyText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return jsonMatch[0];
        }
        return null;
      });

      if (content) {
        try {
          return JSON.parse(content);
        } catch {
          // Not valid JSON
        }
      }

      // Check if we're still on a Cloudflare challenge page
      const pageTitle = await page.title();
      if (pageTitle.includes('Just a moment') || pageTitle.includes('challenge')) {
        throw new Error('Cloudflare challenge not resolved. Please try again.');
      }

      throw new Error('Could not extract JSON data from response');
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch JSON from swgoh.gg via Puppeteer, passing the work through
   * a shared request queue so that multiple Discord commands do not
   * overwhelm the host or trigger anti-bot protections.
   */
  private async fetchWithPuppeteer(url: string): Promise<any> {
    return await swgohGgRequestQueue.add(() => this.fetchWithPuppeteerInternal(url));
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async getGacBracket(allyCode: string): Promise<GacBracketData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/gac-bracket/`;
      
      const data = await this.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data.data;
    } catch (error: any) {
      logger.error(`Error fetching GAC bracket for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('GAC bracket not found. The player may not be in an active GAC bracket.');
      }
      
      if (error.message?.includes('Cloudflare')) {
        throw new Error(
          'Cloudflare challenge could not be resolved. Please try again in a few moments.'
        );
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch GAC bracket: ${error.message}`);
      }
      
      throw new Error('Failed to fetch GAC bracket. Please try again later.');
    }
  }

  /**
   * Scrape defensive squads from a single GAC event page.
   */
  private async scrapeGacEventDefensiveSquads(page: Page): Promise<GacDefensiveSquad[]> {
    const squads: GacDefensiveSquad[] = await page.evaluate(() => {
        const result: GacDefensiveSquad[] = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc: any = (globalThis as any).document;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const defenseTab = doc.querySelector('#battles-defense') as any;
        if (!defenseTab) {
          return result;
        }

        const defenseSides = Array.from(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (defenseTab.querySelectorAll(
            '.gac-counters-battle-summary__side.gac-counters-battle-summary__side--defense'
          ) as any)
        );

        for (const side of defenseSides) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const layout = (side as any).querySelector('.gac-battle-portrait-layout--character') as any;
          if (!layout) {
            continue;
          }

          const leaderUnitContainer = layout.querySelector(
            '.gac-battle-portrait-layout__lead .gac-battle-portrait-layout__unit'
          ) as any;

          if (!leaderUnitContainer) {
            continue;
          }

          const parseUnit = (container: any): GacDefensiveSquadUnit | null => {
            const portrait = container.querySelector('.character-portrait') as any;
            if (!portrait) {
              return null;
            }

            const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
            if (!baseId) {
              return null;
            }

            let portraitUrl: string | null = null;
            const img = container.querySelector('.character-portrait__img') as any;
            if (img && img.getAttribute) {
              const src = img.getAttribute('src') as string | null;
              if (src) {
                portraitUrl = src;
              }
            }

            let relicLevel: number | null = null;
            const relicText = container.querySelector('div.relic-badge text') as any;
            if (relicText && relicText.textContent) {
              const parsed = parseInt(relicText.textContent.trim(), 10);
              if (!Number.isNaN(parsed)) {
                // Clamp relic level to valid range (0-10, max is 10)
                relicLevel = Math.max(0, Math.min(10, parsed));
              }
            }

            return {
              baseId,
              relicLevel,
              portraitUrl
            };
          };

          const leader = parseUnit(leaderUnitContainer);
          if (!leader) {
            continue;
          }

          const memberContainers = Array.from(
            layout.querySelectorAll(
              '.gac-battle-portrait-layout__members .gac-battle-portrait-layout__unit'
            ) as any
          );

          const members: GacDefensiveSquadUnit[] = [];
          for (const mc of memberContainers) {
            const unit = parseUnit(mc);
            if (unit) {
              members.push(unit);
            }
          }

          result.push({
            leader,
            members
          });
        }

        return result;
      });

    return squads;
  }

  /**
   * Fetch recent GAC history event pages (up to the last N rounds/events) for a player
   * and extract all defensive squads across those events.
   * @param format - '5v5' or '3v3' to filter by GAC format
   */
  async getPlayerRecentGacDefensiveSquads(allyCode: string, format: string = '5v5', maxRounds = 4): Promise<GacDefensiveSquad[]> {
    return await swgohGgRequestQueue.add(async () => {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        const historyUrl = `https://swgoh.gg/p/${allyCode}/gac-history/`;

        await page.goto(historyUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Basic Cloudflare / error check
        const title = await page.title();
        if (title.includes('Just a moment') || title.toLowerCase().includes('error')) {
          throw new Error('Cloudflare challenge not resolved. Please try again.');
        }

        // Wait for GAC history content to be visible - React app needs time to render
        try {
          // First wait for the paper container
          await page.waitForSelector('.paper', { timeout: 10000 });
          
          // Then wait for React to actually render the season headers
          // This ensures the content is fully loaded, not just the skeleton
          await page.waitForFunction(
            () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc: any = (globalThis as any).document;
              const papers = Array.from(doc.querySelectorAll('.paper')) as any[];
              let hasSeasonHeader = false;
              for (const paper of papers) {
                const h2 = paper.querySelector('h2');
                if (h2 && h2.textContent && h2.textContent.includes('Season')) {
                  hasSeasonHeader = true;
                  break;
                }
              }
              return hasSeasonHeader;
            },
            { timeout: 15000 }
          ).catch(() => {
            logger.warn('Season headers not found after waiting for React render - page may be empty or still loading');
          });
          
          // Additional small delay to ensure all content is rendered
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.warn('Error waiting for page content, continuing anyway:', error);
        }

        // Collect event URLs from the latest rounds/events matching the format (limited by maxRounds)
        const eventUrls = await page.evaluate((maxRounds: number, format: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc: any = (globalThis as any).document;
          const papers = Array.from(doc.querySelectorAll('.paper')) as any[];

          const debugInfo: any = {
            totalPapers: papers.length,
            papersWithH2: 0,
            papersWithH2Text: 0,
            sectionTitles: [] as string[],
            matchingSections: 0,
            allAnchors: 0,
            matchingHrefs: 0,
            skippedNoData: 0
          };

          // Filter sections by format (5v5 or 3v3)
          const formatSections: any[] = [];
          const formatPattern = format.toLowerCase() === '3v3' ? '(3v3)' : '(5v5)';
          
          for (const paper of papers) {
            const h2 = paper.querySelector('h2');
            if (h2) {
              debugInfo.papersWithH2++;
              // Get text content including nested spans
              const text = h2.textContent || h2.innerText || '';
              if (text.trim()) {
                debugInfo.papersWithH2Text++;
                debugInfo.sectionTitles.push(text.trim());
                if (text.toLowerCase().includes(formatPattern)) {
                  formatSections.push(paper);
                  debugInfo.matchingSections++;
                }
              }
            }
          }

          // If no matching format sections found, try fallback strategies
          let sectionsToProcess: any[] = [];
          
          if (formatSections.length > 0) {
            sectionsToProcess = formatSections;
          } else {
            // Fallback 1: Try papers with h2 that have text (might be different format)
            sectionsToProcess = papers.filter((paper: any) => {
              const h2 = paper.querySelector('h2');
              return h2 && (h2.textContent || h2.innerText);
            });
            
            // Fallback 2: If still nothing, try papers that have gac-history links (content exists)
            if (sectionsToProcess.length === 0) {
              sectionsToProcess = papers.filter((paper: any) => {
                const links = paper.querySelectorAll('a[href*="/gac-history/"]');
                return links.length > 0;
              });
            }
          }

          // Collect all valid event URLs from all sections (not limited by season count)
          const allValidHrefs: string[] = [];

          for (const section of sectionsToProcess) {
            // Find all event rows (each event can have multiple rounds)
            const eventRows = Array.from(
              section.querySelectorAll('.link-no-style')
            ) as any[];
            
            for (const eventRow of eventRows) {
              // Check if this event row has "No Player Data" message
              const noDataMessage = eventRow.querySelector('.message');
              if (noDataMessage && noDataMessage.textContent && 
                  noDataMessage.textContent.trim().toLowerCase().includes('no player data')) {
                // Skip events with "No Player Data" - these are future/ongoing events
                debugInfo.skippedNoData++;
                continue;
              }
              
              // Only process events that have actual content blocks (data exists)
              const contentBlocks = eventRow.querySelectorAll('.content-block');
              if (contentBlocks.length === 0) {
                // No content blocks means no data - skip this event
                debugInfo.skippedNoData++;
                continue;
              }
              
              // Extract anchors from events that have data
              const anchors = Array.from(
                eventRow.querySelectorAll('a[href*="/gac-history/"]')
              ) as any[];
              debugInfo.allAnchors += anchors.length;

              for (const a of anchors) {
                const href = (a.getAttribute('href') as string) || '';
                if (/\/gac-history\/O\d+\/\d+\//.test(href)) {
                  if (!allValidHrefs.includes(href)) {
                    allValidHrefs.push(href);
                    debugInfo.matchingHrefs++;
                  }
                }
              }
            }
          }

          // Parse event IDs and round numbers to find the most recent round
          // URLs are in format: /gac-history/O{eventId}/{roundNumber}/
          const parsedUrls = allValidHrefs.map(href => {
            const match = href.match(/\/gac-history\/O(\d+)\/(\d+)\//);
            if (match) {
              return {
                href,
                eventId: parseInt(match[1], 10),
                roundNumber: parseInt(match[2], 10)
              };
            }
            return null;
          }).filter(Boolean) as Array<{ href: string; eventId: number; roundNumber: number }>;
          
          // Sort by event ID (descending, most recent first), then by round number (descending, highest round first)
          parsedUrls.sort((a, b) => {
            if (a.eventId !== b.eventId) {
              return b.eventId - a.eventId; // Most recent event first
            }
            return b.roundNumber - a.roundNumber; // Highest round first
          });
          
          // Take only the most recent round (first after sorting)
          const hrefs = parsedUrls.length > 0 ? [parsedUrls[0].href] : [];

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win: any = (globalThis as any).window;
          const base = win.location.origin as string;

          return {
            eventUrls: hrefs.map(href => new URL(href, base).toString()),
            debug: debugInfo
          };
        }, maxRounds, format);

        const debugInfo = eventUrls.debug;
        const urls = eventUrls.eventUrls;

        logger.info(
          `GAC history page analysis for ally code ${allyCode} (format: ${format}): ` +
          `${debugInfo.totalPapers} paper(s) found, ` +
          `${debugInfo.papersWithH2} paper(s) with h2, ` +
          `${debugInfo.papersWithH2Text} paper(s) with h2 text, ` +
          `${debugInfo.matchingSections} ${format} section(s), ` +
          `${debugInfo.allAnchors} anchor(s) with gac-history, ` +
          `${debugInfo.matchingHrefs} total valid round(s) found, ` +
          `${debugInfo.skippedNoData} event(s) skipped (no data), ` +
          `${urls.length} round(s) selected (max ${maxRounds}). ` +
          `Section titles: ${debugInfo.sectionTitles.length > 0 ? debugInfo.sectionTitles.slice(0, 5).join(', ') : '(none found)'}`
        );

        if (!urls || urls.length === 0) {
          logger.warn(
            `No GAC history event URLs found for ally code ${allyCode}. ` +
            `This may indicate the player has no recent GAC history or the page structure has changed.`
          );
          throw new Error('No GAC history events with data were found for this player.');
        }

        logger.info(`Found ${urls.length} GAC history event(s) for ally code ${allyCode}`);

        const allSquads: GacDefensiveSquad[] = [];
        const eventsWithData: string[] = [];
        const eventsWithoutData: string[] = [];

        // Only use the MOST RECENT round (first URL) to get the opponent's current defensive strategy
        // Players may change their defensive strategy between rounds, so we should use only the latest round
        const mostRecentEventUrl = urls[0];
        
        try {
          logger.info(`Scraping most recent GAC event: ${mostRecentEventUrl}`);
          await page.goto(mostRecentEventUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });

          const squads = await this.scrapeGacEventDefensiveSquads(page);
          
          if (squads.length === 0) {
            logger.warn(`Most recent event ${mostRecentEventUrl} returned 0 defensive squads - trying next event`);
            eventsWithoutData.push(mostRecentEventUrl);
            
            // Fallback: try the next event if the most recent has no data
            if (urls.length > 1) {
              const nextEventUrl = urls[1];
              logger.info(`Trying next most recent event: ${nextEventUrl}`);
              await page.goto(nextEventUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
              });
              
              const fallbackSquads = await this.scrapeGacEventDefensiveSquads(page);
              if (fallbackSquads.length > 0) {
                logger.info(`Fallback event ${nextEventUrl} returned ${fallbackSquads.length} defensive squad(s)`);
                eventsWithData.push(nextEventUrl);
                allSquads.push(...fallbackSquads);
              } else {
                eventsWithoutData.push(nextEventUrl);
              }
            }
          } else {
            logger.info(`Most recent event ${mostRecentEventUrl} returned ${squads.length} defensive squad(s)`);
            eventsWithData.push(mostRecentEventUrl);
            allSquads.push(...squads);
          }
        } catch (error: any) {
          logger.error(`Error scraping most recent event ${mostRecentEventUrl}:`, error);
          eventsWithoutData.push(mostRecentEventUrl);
          // Continue to next event instead of failing completely
          if (urls.length > 1) {
            const nextEventUrl = urls[1];
            try {
              logger.info(`Trying next most recent event: ${nextEventUrl}`);
              await page.goto(nextEventUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
              });
              
              const fallbackSquads = await this.scrapeGacEventDefensiveSquads(page);
              if (fallbackSquads.length > 0) {
                logger.info(`Fallback event ${nextEventUrl} returned ${fallbackSquads.length} defensive squad(s)`);
                eventsWithData.push(nextEventUrl);
                allSquads.push(...fallbackSquads);
              } else {
                eventsWithoutData.push(nextEventUrl);
              }
            } catch (fallbackError: any) {
              logger.error(`Error scraping fallback event ${nextEventUrl}:`, fallbackError);
              eventsWithoutData.push(nextEventUrl);
            }
          }
        }

        // Only throw error if ALL events had no data
        if (allSquads.length === 0) {
          logger.error(
            `All ${urls.length} GAC history event(s) for ally code ${allyCode} had no data. ` +
            `Events with data: ${eventsWithData.length}, Events without data: ${eventsWithoutData.length}`
          );
          throw new Error('No GAC history events with data were found for this player.');
        }

        logger.info(
          `Successfully collected ${allSquads.length} defensive squad(s) from most recent event ` +
          `(${eventsWithData[0] || 'unknown'}) for ally code ${allyCode}. ` +
          `Skipped ${eventsWithoutData.length} event(s) with no data.`
        );

        return allSquads;
      } catch (error: any) {
        logger.error(`Error scraping GAC defensive squads for ally code ${allyCode}:`, error);

        if (error.message?.includes('Cloudflare')) {
          throw new Error(
            'Cloudflare challenge could not be resolved when reading GAC history. Please try again shortly.'
          );
        }

        if (error.message) {
          throw new Error(`Failed to read GAC defensive history: ${error.message}`);
        }

        throw new Error('Failed to read GAC defensive history. Please try again later.');
      } finally {
        await page.close();
      }
    });
  }

  async getPlayer(allyCode: string): Promise<SwgohGgPlayerData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/`;
      
      const data = await this.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data.data;
    } catch (error: any) {
      logger.error(`Error fetching player data for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('Player not found. Please check the ally code.');
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch player data: ${error.message}`);
      }
      
      throw new Error('Failed to fetch player data. Please try again later.');
    }
  }

  async getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/`;
      
      const data = await this.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data as SwgohGgFullPlayerResponse;
    } catch (error: any) {
      logger.error(`Error fetching full player data for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('Player not found. Please check the ally code.');
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch player data: ${error.message}`);
      }
      
      throw new Error('Failed to fetch player data. Please try again later.');
    }
  }

  /**
   * Scrape counter squads from swgoh.gg counters page for a given defensive squad leader.
   * Returns counter squads sorted by win percentage (highest first).
   * 
   * If seasonId is provided, checks cache first before scraping.
   * Scraped results are cached for future use.
   */
  async getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]> {
    return await swgohGgRequestQueue.add(async () => {
      // Check cache first if seasonId is provided
      if (seasonId) {
        const cached = await counterCache.getCachedCounters(seasonId, defensiveLeaderBaseId);
        if (cached !== null && cached.length > 0) {
          return cached;
        }
      }

      const browser = await this.getBrowser();
      
      // Try with season ID first, then fallback to no season ID if no results
      const tryGetCounters = async (useSeasonId?: string): Promise<GacCounterSquad[]> => {
        const page = await browser.newPage();

        try {
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          );

          // Build the counters URL with better parameters for more comprehensive data
          // cutoff=0: Show all counters (no minimum threshold)
          // sort=count: Sort by seen count (most common counters first)
          // page=1: First page of results
          const baseUrl = 'https://swgoh.gg';
          const countersPath = `/gac/counters/${defensiveLeaderBaseId}/`;
          const params: string[] = ['cutoff=0', 'sort=count', 'page=1'];
          
          if (useSeasonId) {
            params.push(`season_id=${useSeasonId}`);
          }
          
          const url = `${baseUrl}${countersPath}?${params.join('&')}`;

          await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });

          // Basic Cloudflare / error check
          const title = await page.title();
          if (title.includes('Just a moment') || title.toLowerCase().includes('error')) {
            throw new Error('Cloudflare challenge not resolved. Please try again.');
          }

          // Wait for counter entries to appear (the page uses JavaScript to render)
          try {
            await page.waitForSelector('.paper.paper--size-sm', { timeout: 10000 });
            // Give a small additional delay to ensure all content is rendered
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            logger.warn(`No counter entries found on page for ${defensiveLeaderBaseId}${useSeasonId ? ` (season: ${useSeasonId})` : ''}, page may be empty or still loading`);
            // Continue anyway - the evaluate will return empty array if nothing found
          }

        // Scrape counter squads from the page
        const counterSquads: GacCounterSquad[] = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc: any = (globalThis as any).document;
          const result: GacCounterSquad[] = [];

          // Find all counter entries (papers with offense and defense squads)
          const papers = Array.from(doc.querySelectorAll('.paper.paper--size-sm')) as any[];
          
          // Debug: log how many papers we found
          if (papers.length === 0) {
            console.warn('No .paper.paper--size-sm elements found on page');
          }

          for (const paper of papers) {
            // Find the offense squad (left side) - try multiple selector variations
            let offenseContainer = paper.querySelector('.d-flex.col-gap-2.justify-content-center.justify-content-lg-end');
            if (!offenseContainer) {
              // Try alternative selector without flex-1
              offenseContainer = paper.querySelector('.d-flex.col-gap-2.justify-content-center.justify-content-lg-end.flex-1');
            }
            if (!offenseContainer) {
              // Try even more flexible selector
              offenseContainer = paper.querySelector('.d-flex.col-gap-2.justify-content-lg-end');
            }
            if (!offenseContainer) {
              continue;
            }

            // Parse offense squad units - leader has w-48px class, members have w-40px
            const offenseUnits: GacDefensiveSquadUnit[] = [];
            
            // Get leader first (w-48px) - try multiple selector variations
            let leaderLink = offenseContainer.querySelector('a.w-48px[href*="a_lead"]') as any;
            if (!leaderLink) {
              // Try without href requirement (some pages might not have the href)
              leaderLink = offenseContainer.querySelector('a.w-48px.d-block') as any;
            }
            if (!leaderLink) {
              // Try just finding the first w-48px element
              leaderLink = offenseContainer.querySelector('.w-48px a') as any;
            }
            if (leaderLink) {
              const portrait = leaderLink.querySelector('.character-portrait[data-unit-def-tooltip-app]');
              if (portrait) {
                const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
                if (baseId) {
                  let portraitUrl: string | null = null;
                  const img = portrait.querySelector('.character-portrait__img');
                  if (img && img.getAttribute) {
                    portraitUrl = img.getAttribute('src') as string | null;
                  }
                  offenseUnits.push({
                    baseId,
                    relicLevel: null,
                    portraitUrl
                  });
                }
              }
            }

            // Get members (w-40px with a_member) - try multiple selector variations
            let memberLinks = Array.from(
              offenseContainer.querySelectorAll('a.w-40px[href*="a_member"]')
            ) as any[];
            if (memberLinks.length === 0) {
              // Try without href requirement
              memberLinks = Array.from(
                offenseContainer.querySelectorAll('a.w-40px.d-block')
              ) as any[];
            }
            if (memberLinks.length === 0) {
              // Try finding all w-40px links
              memberLinks = Array.from(
                offenseContainer.querySelectorAll('.w-40px a')
              ) as any[];
            }

            for (const memberLink of memberLinks) {
              const portrait = memberLink.querySelector('.character-portrait[data-unit-def-tooltip-app]');
              if (!portrait) {
                continue;
              }

              const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
              if (!baseId) {
                continue;
              }

              let portraitUrl: string | null = null;
              const img = portrait.querySelector('.character-portrait__img');
              if (img && img.getAttribute) {
                portraitUrl = img.getAttribute('src') as string | null;
              }

              offenseUnits.push({
                baseId,
                relicLevel: null,
                portraitUrl
              });
            }

            if (offenseUnits.length === 0) {
              // Debug: log why we skipped this paper
              console.warn('Skipping paper - no offense units found');
              continue;
            }

            // Extract stats (Seen, Win %, Avg banners) - try multiple selector variations
            let statsContainer = paper.querySelector('.white-space-nowrap.d-flex.align-items-center');
            if (!statsContainer) {
              // Try alternative selector
              statsContainer = paper.querySelector('.white-space-nowrap.d-flex.align-items-center.flex-1');
            }
            let winPercentage: number | null = null;
            let seenCount: number | null = null;
            let avgBanners: number | null = null;

            if (statsContainer) {
              const statDivs = Array.from(statsContainer.querySelectorAll('.flex-1')) as any[];
              if (statDivs.length >= 3) {
                // First stat: Seen
                const seenText = statDivs[0]?.querySelector('.fw-bold')?.textContent?.trim();
                if (seenText) {
                  seenCount = parseInt(seenText.replace(/,/g, ''), 10) || null;
                }

                // Second stat: Win %
                const winText = statDivs[1]?.querySelector('.fw-bold')?.textContent?.trim();
                if (winText) {
                  winPercentage = parseFloat(winText.replace('%', '')) || null;
                }

                // Third stat: Avg banners
                const avgText = statDivs[2]?.querySelector('.fw-bold')?.textContent?.trim();
                if (avgText) {
                  avgBanners = parseFloat(avgText) || null;
                }
              }
            }

            // Separate leader from members
            const leader = offenseUnits[0];
            const members = offenseUnits.slice(1);

            result.push({
              leader,
              members,
              winPercentage,
              seenCount,
              avgBanners
            });
          }

          return result;
        });

        // Sort by win percentage (highest first), then by seen count
        counterSquads.sort((a, b) => {
          if (a.winPercentage !== null && b.winPercentage !== null) {
            if (b.winPercentage !== a.winPercentage) {
              return b.winPercentage - a.winPercentage;
            }
          }
          if (a.seenCount !== null && b.seenCount !== null) {
            return b.seenCount - a.seenCount;
          }
          return 0;
        });

          // Log if no squads found for debugging
          if (counterSquads.length === 0) {
            logger.warn(`No counter squads found for ${defensiveLeaderBaseId}${useSeasonId ? ` (season: ${useSeasonId})` : ''}. This might indicate the page structure has changed or no counters exist.`);
          } else {
            logger.info(`Found ${counterSquads.length} counter squad(s) for ${defensiveLeaderBaseId}${useSeasonId ? ` (season: ${useSeasonId})` : ' (no season filter)'}`);
          }

          return counterSquads;
        } catch (error: any) {
          logger.error(`Error scraping counter squads for ${defensiveLeaderBaseId}${useSeasonId ? ` (season: ${useSeasonId})` : ''}:`, error);
          throw error; // Re-throw to be handled by outer try-catch
        } finally {
          await page.close();
        }
      };

      // Try with season ID first
      let counterSquads: GacCounterSquad[] = [];
      let usedSeasonIdForCache = false; // Track if we should cache the result
      
      if (seasonId) {
        try {
          counterSquads = await tryGetCounters(seasonId);
          usedSeasonIdForCache = true; // We got results with seasonId, so we can cache them
        } catch (error: any) {
          // If Cloudflare or other critical error, don't fallback
          if (error.message?.includes('Cloudflare')) {
            throw new Error(
              'Cloudflare challenge could not be resolved when reading counters. Please try again shortly.'
            );
          }
          // For other errors, log and try fallback
          logger.warn(`Failed to get counters with season ${seasonId}, trying without season filter:`, error.message);
        }
      }

      // If no results with season ID, try without season ID as fallback
      if (counterSquads.length === 0 && seasonId) {
        logger.info(`No counters found for ${defensiveLeaderBaseId} with season ${seasonId}, trying without season filter as fallback`);
        try {
          counterSquads = await tryGetCounters(undefined);
          if (counterSquads.length > 0) {
            logger.info(`Fallback successful: Found ${counterSquads.length} counter(s) for ${defensiveLeaderBaseId} without season filter`);
          }
          // Don't cache fallback results (no seasonId) - only cache season-specific results
        } catch (error: any) {
          logger.error(`Error in fallback attempt for ${defensiveLeaderBaseId}:`, error);
          // If fallback also fails, throw the original error or a generic one
          if (error.message?.includes('Cloudflare')) {
            throw new Error(
              'Cloudflare challenge could not be resolved when reading counters. Please try again shortly.'
            );
          }
          throw new Error(`Failed to read counter squads: ${error.message || 'Unknown error'}`);
        }
      } else if (!seasonId) {
        // If no season ID was provided, just try once without it
        try {
          counterSquads = await tryGetCounters(undefined);
        } catch (error: any) {
          logger.error(`Error scraping counter squads for ${defensiveLeaderBaseId}:`, error);
          if (error.message?.includes('Cloudflare')) {
            throw new Error(
              'Cloudflare challenge could not be resolved when reading counters. Please try again shortly.'
            );
          }
          if (error.message) {
            throw new Error(`Failed to read counter squads: ${error.message}`);
          }
          throw new Error('Failed to read counter squads. Please try again later.');
        }
      }

      // Cache the results if we successfully scraped with a seasonId
      if (usedSeasonIdForCache && seasonId && counterSquads.length > 0) {
        // Non-blocking cache save - don't await to avoid slowing down response
        counterCache.saveCounters(seasonId, defensiveLeaderBaseId, counterSquads).catch(err => {
          logger.warn(`Failed to cache counters for ${defensiveLeaderBaseId}:`, err);
        });
      }

      return counterSquads;
    });
  }

  /**
   * Scrape top defense squads from swgoh.gg/gac/squads/ page.
   * Returns defense squads sorted by hold percentage (highest first) or by count if sort=percent is not used.
   * 
   * @param sortBy - Sort order: 'percent' for hold percentage, 'count' for seen count, 'banners' for avg banners
   * @param seasonId - Optional season ID to filter by
   * @param format - GAC format ('5v5' or '3v3'). If seasonId is not provided, will try to infer from format
   */
  async getTopDefenseSquads(sortBy: 'percent' | 'count' | 'banners' = 'count', seasonId?: string, format?: string): Promise<GacTopDefenseSquad[]> {
    // Determine the correct season ID based on format (before cache check)
    // For 3v3, we need an odd-numbered season (71, 69, 67, etc.)
    // For 5v5, we need an even-numbered season (72, 70, 68, etc.)
    let finalSeasonId = seasonId;
    
    if (format) {
      if (finalSeasonId) {
        // Check if the provided season ID matches the requested format
        const seasonMatch = finalSeasonId.match(/SEASON_(\d+)/);
        if (seasonMatch) {
          const seasonNumber = parseInt(seasonMatch[1], 10);
          const isSeason3v3 = seasonNumber % 2 === 1; // Odd = 3v3, Even = 5v5
          
          // If format doesn't match season, override it
          if (format === '3v3' && !isSeason3v3) {
            // Use the most recent 3v3 season (odd number, lower than current if current is even)
            const threeV3Season = seasonNumber % 2 === 0 ? seasonNumber - 1 : seasonNumber;
            finalSeasonId = `CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_${threeV3Season}`;
            logger.info(`Format is 3v3 but season ${seasonNumber} is 5v5, using season ${threeV3Season} for 3v3 data`);
          } else if (format === '5v5' && isSeason3v3) {
            // Use the most recent 5v5 season (even number, higher than current if current is odd)
            const fiveV5Season = seasonNumber % 2 === 1 ? seasonNumber + 1 : seasonNumber;
            finalSeasonId = `CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_${fiveV5Season}`;
            logger.info(`Format is 5v5 but season ${seasonNumber} is 3v3, using season ${fiveV5Season} for 5v5 data`);
          }
        }
      } else {
        // No season ID provided, determine based on format
        if (format === '3v3') {
          // Use the most recent 3v3 season (Season 71 as of sample HTML)
          finalSeasonId = 'CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_71';
        }
        // For 5v5, don't set seasonId - let the page show current season (typically 5v5)
      }
    }

    // Check cache first (using finalSeasonId)
    const cached = await defenseSquadCache.getCachedDefenseSquads(finalSeasonId, format, sortBy);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from swgoh.gg
    return await swgohGgRequestQueue.add(async () => {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Build the URL
        // cutoff=0: Show all squads (no minimum threshold) - gives best data coverage
        // sort=count/percent/banners: Sort order
        const baseUrl = 'https://swgoh.gg';
        let url = `${baseUrl}/gac/squads/`;
        const params: string[] = ['cutoff=0']; // Always use cutoff=0 to get all squads
        
        if (sortBy === 'percent') {
          params.push('sort=percent');
        } else if (sortBy === 'banners') {
          params.push('sort=banners');
        } else {
          // Default to 'count' if not specified
          params.push('sort=count');
        }
        
        // finalSeasonId is already calculated before the queue
        if (finalSeasonId) {
          params.push(`season_id=${finalSeasonId}`);
        }
        
        url += `?${params.join('&')}`;

        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Basic Cloudflare / error check
        const title = await page.title();
        if (title.includes('Just a moment') || title.toLowerCase().includes('error')) {
          throw new Error('Cloudflare challenge not resolved. Please try again.');
        }

        // Scrape defense squads from the page
        const defenseSquads: GacTopDefenseSquad[] = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc: any = (globalThis as any).document;
          const result: GacTopDefenseSquad[] = [];

          // Find the data table
          const table = doc.querySelector('.data-table tbody');
          if (!table) {
            return result;
          }

          // Get all rows
          const rows = Array.from(table.querySelectorAll('tr')) as any[];

          for (const row of rows) {
            // Get the units column (first td)
            const unitsCell = row.querySelector('td');
            if (!unitsCell) {
              continue;
            }

            // Get units - leader is in w-48px div, members are in w-40px divs
            const units: GacDefensiveSquadUnit[] = [];
            
            // Get leader first (w-48px)
            const leaderDiv = unitsCell.querySelector('.w-48px');
            if (leaderDiv) {
              const leaderLink = leaderDiv.querySelector('a');
              if (leaderLink) {
                const portrait = leaderLink.querySelector('.character-portrait[data-unit-def-tooltip-app]');
                if (portrait) {
                  const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
                  if (baseId) {
                    let portraitUrl: string | null = null;
                    const img = portrait.querySelector('.character-portrait__img');
                    if (img && img.getAttribute) {
                      portraitUrl = img.getAttribute('src') as string | null;
                    }
                    units.push({
                      baseId,
                      relicLevel: null,
                      portraitUrl
                    });
                  }
                }
              }
            }

            // Get members (w-40px)
            const memberDivs = Array.from(unitsCell.querySelectorAll('.w-40px')) as any[];
            for (const memberDiv of memberDivs) {
              const memberLink = memberDiv.querySelector('a');
              if (!memberLink) {
                continue;
              }
              
              const portrait = memberLink.querySelector('.character-portrait[data-unit-def-tooltip-app]');
              if (!portrait) {
                continue;
              }

              const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
              if (!baseId) {
                continue;
              }

              let portraitUrl: string | null = null;
              const img = portrait.querySelector('.character-portrait__img');
              if (img && img.getAttribute) {
                portraitUrl = img.getAttribute('src') as string | null;
              }

              units.push({
                baseId,
                relicLevel: null,
                portraitUrl
              });
            }

            if (units.length === 0) {
              continue;
            }

            // Get stats from the remaining td elements
            const allCells = Array.from(row.querySelectorAll('td')) as any[];
            if (allCells.length < 4) {
              continue;
            }

            // Parse Seen count (second td, e.g., "132K" or "82.7K")
            const seenCell = allCells[1];
            let seenCount: number | null = null;
            if (seenCell) {
              const seenText = seenCell.textContent?.trim() || '';
              // Handle "K" suffix (e.g., "132K" = 132000)
              if (seenText.endsWith('K')) {
                const num = parseFloat(seenText.replace('K', ''));
                seenCount = isNaN(num) ? null : Math.round(num * 1000);
              } else {
                seenCount = parseInt(seenText.replace(/,/g, ''), 10) || null;
              }
            }

            // Parse Hold % (third td, e.g., "23%")
            const holdCell = allCells[2];
            let holdPercentage: number | null = null;
            if (holdCell) {
              const holdText = holdCell.textContent?.trim() || '';
              holdPercentage = parseFloat(holdText.replace('%', '')) || null;
            }

            // Parse Banners (fourth td, e.g., "47.85")
            const bannersCell = allCells[3];
            let avgBanners: number | null = null;
            if (bannersCell) {
              const bannersText = bannersCell.textContent?.trim() || '';
              avgBanners = parseFloat(bannersText) || null;
            }

            // Separate leader from members (first unit is leader)
            const leader = units[0];
            const members = units.slice(1);

            result.push({
              leader,
              members,
              holdPercentage,
              seenCount,
              avgBanners
            });
          }

          return result;
        });

        // Sort based on sortBy parameter
        if (sortBy === 'percent') {
          defenseSquads.sort((a, b) => {
            if (a.holdPercentage !== null && b.holdPercentage !== null) {
              return b.holdPercentage - a.holdPercentage;
            }
            if (a.holdPercentage !== null) return -1;
            if (b.holdPercentage !== null) return 1;
            return 0;
          });
        } else if (sortBy === 'banners') {
          defenseSquads.sort((a, b) => {
            if (a.avgBanners !== null && b.avgBanners !== null) {
              return b.avgBanners - a.avgBanners;
            }
            if (a.avgBanners !== null) return -1;
            if (b.avgBanners !== null) return 1;
            return 0;
          });
        } else {
          // Default: sort by count
          defenseSquads.sort((a, b) => {
            if (a.seenCount !== null && b.seenCount !== null) {
              return b.seenCount - a.seenCount;
            }
            if (a.seenCount !== null) return -1;
            if (b.seenCount !== null) return 1;
            return 0;
          });
        }

        // Save to cache (non-blocking, using finalSeasonId)
        defenseSquadCache.saveDefenseSquads(finalSeasonId, format, sortBy, defenseSquads)
          .catch(err => logger.warn('Failed to cache defense squads:', err));

        return defenseSquads;
      } catch (error: any) {
        logger.error(`Error scraping top defense squads:`, error);

        if (error.message?.includes('Cloudflare')) {
          throw new Error(
            'Cloudflare challenge could not be resolved when reading top defense squads. Please try again shortly.'
          );
        }

        if (error.message) {
          throw new Error(`Failed to read top defense squads: ${error.message}`);
        }

        throw new Error('Failed to read top defense squads. Please try again later.');
      } finally {
        await page.close();
      }
    });
  }
}

