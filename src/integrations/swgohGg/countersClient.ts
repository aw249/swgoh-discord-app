/**
 * Client for scraping counter squads from swgoh.gg
 */
import { logger } from '../../utils/logger';
import { GacCounterSquad, GacDefensiveSquadUnit } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';
import { batchUpdatePortraitUrls } from '../../storage/characterPortraitCache';
import { counterCache } from '../../storage/counterCache';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

export class CountersClient {
  constructor(private readonly browserManager: BrowserManager) {}

  /**
   * Scrape counter squads from swgoh.gg counters page for a given defensive squad leader.
   * Returns counter squads sorted by win percentage (highest first).
   * 
   * If seasonId is provided, checks cache first before scraping.
   * Scraped results are cached for future use.
   */
  async getCounterSquads(defensiveLeaderBaseId: string, seasonId?: string): Promise<GacCounterSquad[]> {
    return await this.browserManager.queueOperation(async () => {
      // Check cache first if seasonId is provided
      if (seasonId) {
        const cached = await counterCache.getCachedCounters(seasonId, defensiveLeaderBaseId);
        if (cached !== null && cached.length > 0) {
          return cached;
        }
      }

      // Try with season ID first, then fallback to no season ID if no results
      const tryGetCounters = async (useSeasonId?: string): Promise<GacCounterSquad[]> => {
        const page = await this.browserManager.createPage();
        page.setDefaultNavigationTimeout(35000);
        page.setDefaultTimeout(35000);

        try {
          // Build the counters URL with better parameters for more comprehensive data
          // cutoff=0: Show all counters (no minimum threshold)
          // sort=count: Sort by seen count (most common counters first)
          // page=1: First page of results
          const baseUrl = API_ENDPOINTS.SWGOH_GG_BASE;
          const countersPath = `/gac/counters/${defensiveLeaderBaseId}/`;
          const params: string[] = ['cutoff=0', 'sort=count', 'page=1'];
          
          if (useSeasonId) {
            params.push(`season_id=${useSeasonId}`);
          }
          
          const url = `${baseUrl}${countersPath}?${params.join('&')}`;

          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 35000
          });

          // Basic Cloudflare / error check
          const title = await page.title();
          if (title.includes('Just a moment') || title.toLowerCase().includes('error')) {
            throw new Error('Cloudflare challenge not resolved. Please try again.');
          }

          // Counter cards used to be `.paper.paper--size-sm`; layout/MUI or slow Pi breaks a strict wait.
          try {
            await page.waitForFunction(
              () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const doc: any = (globalThis as any).document;
                const t = doc.title || '';
                if (t.includes('Just a moment')) {
                  return false;
                }
                if (doc.querySelector('.paper.paper--size-sm')) {
                  return true;
                }
                if (doc.querySelector('.paper .character-portrait[data-unit-def-tooltip-app]')) {
                  return true;
                }
                if (
                  doc.querySelector('[class*="MuiPaper-root"] .character-portrait[data-unit-def-tooltip-app]')
                ) {
                  return true;
                }
                const root = doc.querySelector('#root');
                if (root && (root.textContent || '').length > 400) {
                  return true;
                }
                return false;
              },
              { timeout: 14000, polling: 200 }
            );
            await new Promise(resolve => setTimeout(resolve, 350));
          } catch (error) {
            logger.warn(
              `Counter list did not become ready in time for ${defensiveLeaderBaseId}` +
                `${useSeasonId ? ` (season: ${useSeasonId})` : ''} — continuing with scrape`
            );
          }

          // Scrape counter squads from the page
          const counterSquads: GacCounterSquad[] = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc: any = (globalThis as any).document;
            const result: GacCounterSquad[] = [];

            // Counter rows: legacy `.paper.paper--size-sm`, or any `.paper` with counter-like layout, or MUI cards
            let papers = Array.from(doc.querySelectorAll('.paper.paper--size-sm')) as any[];
            if (papers.length === 0) {
              const loose = Array.from(doc.querySelectorAll('.paper')) as any[];
              papers = loose.filter(
                (p: any) =>
                  p.querySelector('.character-portrait[data-unit-def-tooltip-app]') &&
                  (p.querySelector('.d-flex.col-gap-2') ||
                    p.querySelector('[class*="justify-content-lg-end"]') ||
                    p.querySelector('[class*="justify-content-center"]'))
              );
            }
            if (papers.length === 0) {
              const raw = Array.from(doc.querySelectorAll('[class*="MuiPaper-root"]')) as any[];
              const outer = raw.filter(
                (el: any) => !raw.some((other: any) => other !== el && other.contains(el))
              );
              papers = outer.filter(
                (p: any) => p.querySelectorAll('.character-portrait[data-unit-def-tooltip-app]').length >= 2
              );
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

      // Update character portrait cache with any new portraits discovered
      if (counterSquads.length > 0) {
        const portraitMappings = counterSquads.flatMap(squad => [
          { baseId: squad.leader.baseId, portraitUrl: squad.leader.portraitUrl },
          ...squad.members.map(m => ({ baseId: m.baseId, portraitUrl: m.portraitUrl }))
        ]);
        // Non-blocking update
        batchUpdatePortraitUrls(portraitMappings).catch(err => {
          logger.debug(`Failed to update portrait cache:`, err);
        });
      }

      return counterSquads;
    });
  }
}

