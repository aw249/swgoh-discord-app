/**
 * Client for scraping top defense squads from swgoh.gg
 */
import { logger } from '../../utils/logger';
import { GacTopDefenseSquad, GacDefensiveSquadUnit } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';
import { batchUpdatePortraitUrls } from '../../storage/characterPortraitCache';
import { defenseSquadCache } from '../../storage/defenseSquadCache';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

export class DefenseSquadsClient {
  constructor(private readonly browserManager: BrowserManager) {}

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
    return await this.browserManager.queueOperation(async () => {
      const page = await this.browserManager.createPage();
      page.setDefaultNavigationTimeout(35000);
      page.setDefaultTimeout(35000);

      try {
        // Build the URL
        // cutoff=0: Show all squads (no minimum threshold) - gives best data coverage
        // sort=count/percent/banners: Sort order
        const baseUrl = API_ENDPOINTS.SWGOH_GG_BASE;
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
          waitUntil: 'load',
          timeout: 35000
        });

        await this.browserManager.settleSwgohGgPageAfterNavigation(page, 60000);

        const title = await page.title();
        if (title.toLowerCase().includes('error')) {
          throw new Error('swgoh.gg returned an error page while loading defense squads list.');
        }

        try {
          await page.waitForFunction(
            () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc: any = (globalThis as any).document;
              const t = doc.title || '';
              if (t.includes('Just a moment')) {
                return false;
              }
              return !!(
                doc.querySelector('table.stat-table tbody tr') ||
                doc.querySelector('.data-table tbody tr') ||
                doc.querySelector('table tbody tr') ||
                doc.querySelector('table.stat-table tbody') ||
                doc.querySelector('.data-table tbody')
              );
            },
            { timeout: 12000, polling: 200 }
          );
          await new Promise(r => setTimeout(r, 250));
        } catch {
          logger.warn('GAC squads table did not appear in time — attempting scrape anyway');
        }

        // Scrape defense squads from the page
        const defenseSquads: GacTopDefenseSquad[] = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc: any = (globalThis as any).document;
          const result: GacTopDefenseSquad[] = [];

          // Meta squads table: `stat-table` (2025+); legacy `data-table`
          let table = doc.querySelector('table.stat-table tbody');
          if (!table) {
            table = doc.querySelector('.data-table tbody');
          }
          if (!table) {
            table = doc.querySelector('table.data-table tbody');
          }
          if (!table) {
            const alt = doc.querySelector('[class*="data-table"] tbody');
            table = alt || doc.querySelector('table tbody');
          }
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
            
            const pushPortraitFromLink = (link: any): void => {
              if (!link) {
                return;
              }
              const portrait = link.querySelector('.character-portrait[data-unit-def-tooltip-app]');
              if (!portrait) {
                return;
              }
              const baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
              if (!baseId) {
                return;
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
            };

            // Current layout: flex row with w-[48px] leader + w-[40px] members (Tailwind arbitrary widths)
            const flexRow = unitsCell.querySelector('div.flex.gap-x-2');
            if (flexRow && flexRow.children && flexRow.children.length >= 2) {
              const slots = Array.from(flexRow.children) as any[];
              for (const slot of slots) {
                const cls = String(slot.className || '');
                const isSlot =
                  cls.includes('w-[48px]') ||
                  cls.includes('w-[40px]') ||
                  cls.includes('w-48px') ||
                  cls.includes('w-40px');
                if (!isSlot) {
                  continue;
                }
                pushPortraitFromLink(slot.querySelector('a'));
              }
            }

            if (units.length === 0) {
              // Legacy: leader (w-48px), members (w-40px)
              const leaderDiv = unitsCell.querySelector('.w-48px') || unitsCell.querySelector('[class*="w-[48px]"]');
              if (leaderDiv) {
                pushPortraitFromLink(leaderDiv.querySelector('a'));
              }
              const memberDivs = Array.from(
                unitsCell.querySelectorAll('.w-40px, [class*="w-[40px]"]')
              ) as any[];
              for (const memberDiv of memberDivs) {
                pushPortraitFromLink(memberDiv.querySelector('a'));
              }
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

        // Update character portrait cache with any new portraits discovered
        if (defenseSquads.length > 0) {
          const portraitMappings = defenseSquads.flatMap(squad => [
            { baseId: squad.leader.baseId, portraitUrl: squad.leader.portraitUrl },
            ...squad.members.map(m => ({ baseId: m.baseId, portraitUrl: m.portraitUrl }))
          ]);
          // Non-blocking update
          batchUpdatePortraitUrls(portraitMappings).catch(err => {
            logger.debug(`Failed to update portrait cache:`, err);
          });
        }

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

