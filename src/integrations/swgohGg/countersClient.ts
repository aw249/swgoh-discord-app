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
            waitUntil: 'load',
            timeout: 35000
          });

          await this.browserManager.settleSwgohGgPageAfterNavigation(page, 60000);

          const title = await page.title();
          if (title.toLowerCase().includes('error')) {
            throw new Error('swgoh.gg returned an error page while loading counters.');
          }

          // Wait for *counter rows*, not generic #root text (domcontentloaded + root heuristic returned too early).
          try {
            await page.waitForFunction(
              () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const doc: any = (globalThis as any).document;
                const t = doc.title || '';
                if (t.includes('Just a moment')) {
                  return false;
                }
                if (doc.querySelector('.paper.paper--size-sm') || doc.querySelector('.panel.panel--size-sm')) {
                  return true;
                }
                const portraits = doc.querySelectorAll('.character-portrait[data-unit-def-tooltip-app]');
                if (portraits.length >= 6) {
                  return true;
                }
                const anyUnitAttr = doc.querySelectorAll('[data-unit-def-tooltip-app]');
                if (anyUnitAttr.length >= 6) {
                  return true;
                }
                if (doc.querySelector('.paper .character-portrait[data-unit-def-tooltip-app]')) {
                  return true;
                }
                if (
                  doc.querySelectorAll('[class*="MuiPaper-root"] .character-portrait[data-unit-def-tooltip-app]')
                    .length >= 4
                ) {
                  return true;
                }
                return false;
              },
              { timeout: 18000, polling: 250 }
            );
            await new Promise(resolve => setTimeout(resolve, 400));
          } catch (error) {
            logger.warn(
              `Counter list did not become ready in time for ${defensiveLeaderBaseId}` +
                `${useSeasonId ? ` (season: ${useSeasonId})` : ''} — continuing with scrape`
            );
          }

          const runScrape = (): Promise<GacCounterSquad[]> =>
            page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc: any = (globalThis as any).document;
            const result: GacCounterSquad[] = [];

            // Counter rows: legacy `.paper`, current `.panel.panel--size-sm` (swgoh.gg 2025+), or MUI cards
            let papers = Array.from(doc.querySelectorAll('.paper.paper--size-sm')) as any[];
            if (papers.length === 0) {
              papers = Array.from(doc.querySelectorAll('.panel.panel--size-sm')) as any[];
            }
            if (papers.length === 0) {
              const loose = Array.from(doc.querySelectorAll('.paper, .panel')) as any[];
              papers = loose.filter((p: any) => {
                const n = p.querySelectorAll('[data-unit-def-tooltip-app]').length;
                return (
                  n >= 4 ||
                  (p.querySelector('.character-portrait[data-unit-def-tooltip-app]') &&
                    (p.querySelector('.d-flex.col-gap-2') ||
                      p.querySelector('div.flex.gap-x-2') ||
                      p.querySelector('[class*="justify-content-lg-end"]') ||
                      p.querySelector('[class*="justify-content-center"]')))
                );
              });
            }
            if (papers.length === 0) {
              const raw = Array.from(doc.querySelectorAll('[class*="MuiPaper-root"]')) as any[];
              const outer = raw.filter(
                (el: any) => !raw.some((other: any) => other !== el && other.contains(el))
              );
              papers = outer.filter(
                (p: any) => p.querySelectorAll('[data-unit-def-tooltip-app]').length >= 4
              );
            }

            const parseUnitFromPortrait = (portrait: any): { baseId: string; portraitUrl: string | null } | null => {
              if (!portrait || !portrait.getAttribute) {
                return null;
              }
              let baseId = portrait.getAttribute('data-unit-def-tooltip-app') as string | null;
              if (!baseId) {
                const wrap = portrait.closest ? portrait.closest('a[href*="/characters/"]') : null;
                if (wrap && wrap.href) {
                  const m = String(wrap.href).match(/\/characters\/([^/?#]+)/);
                  if (m) {
                    baseId = m[1];
                  }
                }
              }
              if (!baseId) {
                return null;
              }
              let portraitUrl: string | null = null;
              // New layout: portrait URL is in a CSS variable on the portrait element
              const styleAttr = portrait.getAttribute('style') as string | null;
              if (styleAttr) {
                const urlMatch = styleAttr.match(/--character-portrait--image-url:\s*url\(([^)]+)\)/);
                if (urlMatch) {
                  portraitUrl = urlMatch[1];
                }
              }
              // Legacy fallback: img element with src
              if (!portraitUrl) {
                const img = portrait.querySelector('.character-portrait__img');
                if (img && img.getAttribute) {
                  portraitUrl = img.getAttribute('src') as string | null;
                }
              }
              return { baseId, portraitUrl };
            };

            const collectFromCharacterLinks = (root: any): { baseId: string; portraitUrl: string | null }[] => {
              const out: { baseId: string; portraitUrl: string | null }[] = [];
              const seen = new Set<string>();
              const anchors = Array.from(root.querySelectorAll('a[href*="/characters/"]')) as any[];
              for (const a of anchors) {
                const href = String(a.href || '');
                const m = href.match(/\/characters\/([^/?#]+)/);
                if (!m) {
                  continue;
                }
                const baseId = m[1];
                if (seen.has(baseId)) {
                  continue;
                }
                seen.add(baseId);
                const portrait =
                  a.querySelector('.character-portrait[data-unit-def-tooltip-app]') ||
                  a.querySelector('.character-portrait');
                const parsed = portrait ? parseUnitFromPortrait(portrait) : { baseId, portraitUrl: null };
                if (parsed) {
                  out.push(parsed);
                }
              }
              return out;
            };

            const resolveOffenseRoot = (paper: any): any => {
              const candidates = [
                // Tailwind redesign (counter offense column)
                'div.flex.gap-x-2.justify-center.flex-1',
                'div.flex.gap-x-2.flex-1',
                'div[class*="gap-x-2"][class*="lg:justify-end"]',
                'div.flex.gap-x-2',
                '.d-flex.col-gap-2.justify-content-center.justify-content-lg-end',
                '.d-flex.col-gap-2.justify-content-center.justify-content-lg-end.flex-1',
                '.d-flex.col-gap-2.justify-content-lg-end',
                '.d-flex.col-gap-2',
                '[class*="col-gap"][class*="flex"]',
                '[class*="gap-x-2"]',
                '[class*="gap-2"]',
                '.d-flex.gap-2',
                'div.flex.gap-2'
              ];
              for (const sel of candidates) {
                const el = paper.querySelector(sel);
                if (el && el.querySelector && el.querySelector('[data-unit-def-tooltip-app], .character-portrait')) {
                  return el;
                }
              }
              const kids = Array.from(paper.children || []) as any[];
              for (const ch of kids) {
                if (ch.querySelectorAll && ch.querySelectorAll('[data-unit-def-tooltip-app]').length >= 2) {
                  return ch;
                }
              }
              return paper;
            };

            const offenseFromPortraitHalves = (paper: any): { baseId: string; portraitUrl: string | null }[] => {
              const nodes = Array.from(
                paper.querySelectorAll('.character-portrait[data-unit-def-tooltip-app]')
              ) as any[];
              if (nodes.length < 4) {
                return [];
              }
              let offenseLen = 0;
              if (nodes.length >= 10) {
                offenseLen = 5;
              } else if (nodes.length >= 6) {
                offenseLen = 3;
              } else {
                offenseLen = Math.floor(nodes.length / 2);
              }
              const out: { baseId: string; portraitUrl: string | null }[] = [];
              for (let i = 0; i < offenseLen; i++) {
                const u = parseUnitFromPortrait(nodes[i]);
                if (u) {
                  out.push(u);
                }
              }
              return out;
            };

            for (const paper of papers) {
              const offenseRoot = resolveOffenseRoot(paper);
              const offenseUnits: GacDefensiveSquadUnit[] = [];

              let leaderLink = offenseRoot.querySelector('a[href*="a_lead"]') as any;
              if (!leaderLink) {
                leaderLink = offenseRoot.querySelector('a.w-48px[href*="a_lead"]') as any;
              }
              if (!leaderLink) {
                leaderLink = offenseRoot.querySelector('a.w-48px.d-block') as any;
              }
              if (!leaderLink) {
                leaderLink = offenseRoot.querySelector('.w-48px a') as any;
              }
              if (!leaderLink) {
                leaderLink = offenseRoot.querySelector('[class*="w-[48px]"] a') as any;
              }
              if (leaderLink) {
                const portrait =
                  leaderLink.querySelector('.character-portrait[data-unit-def-tooltip-app]') ||
                  leaderLink.querySelector('.character-portrait');
                const parsed = portrait ? parseUnitFromPortrait(portrait) : null;
                if (parsed) {
                  offenseUnits.push({
                    baseId: parsed.baseId,
                    relicLevel: null,
                    portraitUrl: parsed.portraitUrl
                  });
                }
              }

              let memberLinks = Array.from(offenseRoot.querySelectorAll('a[href*="a_member"]')) as any[];
              if (memberLinks.length === 0) {
                memberLinks = Array.from(
                  offenseRoot.querySelectorAll('a.w-40px[href*="a_member"]')
                ) as any[];
              }
              if (memberLinks.length === 0) {
                memberLinks = Array.from(offenseRoot.querySelectorAll('a.w-40px.d-block')) as any[];
              }
              if (memberLinks.length === 0) {
                memberLinks = Array.from(offenseRoot.querySelectorAll('.w-40px a')) as any[];
              }
              if (memberLinks.length === 0) {
                memberLinks = Array.from(
                  offenseRoot.querySelectorAll('[class*="w-[40px]"] a[href*="a_member"]')
                ) as any[];
              }

              for (const memberLink of memberLinks) {
                const portrait =
                  memberLink.querySelector('.character-portrait[data-unit-def-tooltip-app]') ||
                  memberLink.querySelector('.character-portrait');
                if (!portrait) {
                  continue;
                }
                const parsed = parseUnitFromPortrait(portrait);
                if (!parsed) {
                  continue;
                }
                offenseUnits.push({
                  baseId: parsed.baseId,
                  relicLevel: null,
                  portraitUrl: parsed.portraitUrl
                });
              }

              if (offenseUnits.length < 2 && offenseRoot !== paper) {
                const fromLinks = collectFromCharacterLinks(offenseRoot);
                if (fromLinks.length > offenseUnits.length) {
                  offenseUnits.length = 0;
                  for (const u of fromLinks) {
                    offenseUnits.push({ baseId: u.baseId, relicLevel: null, portraitUrl: u.portraitUrl });
                  }
                }
              }

              if (offenseUnits.length < 2) {
                const halves = offenseFromPortraitHalves(paper);
                if (halves.length > offenseUnits.length) {
                  offenseUnits.length = 0;
                  for (const u of halves) {
                    offenseUnits.push({ baseId: u.baseId, relicLevel: null, portraitUrl: u.portraitUrl });
                  }
                }
              }

              if (offenseUnits.length === 0) {
                console.warn('Skipping paper - no offense units found');
                continue;
              }

              // Extract stats (Seen, Win %, Avg banners)
              // Tailwind redesign: div.whitespace-nowrap.flex.items-center wraps three div.flex-1 blocks,
              // each with a div.font-bold value and a sibling label.
              // Legacy Bootstrap: .white-space-nowrap.d-flex.align-items-center with .fw-bold values.
              let statsContainer = paper.querySelector('.whitespace-nowrap.flex.items-center');
              if (!statsContainer) {
                statsContainer = paper.querySelector('.white-space-nowrap.d-flex.align-items-center');
              }
              let winPercentage: number | null = null;
              let seenCount: number | null = null;
              let avgBanners: number | null = null;

              if (statsContainer) {
                const statDivs = Array.from(statsContainer.querySelectorAll('.flex-1')) as any[];
                if (statDivs.length >= 3) {
                  // First stat: Seen
                  const seenEl = statDivs[0]?.querySelector('.font-bold') || statDivs[0]?.querySelector('.fw-bold');
                  const seenText = seenEl?.textContent?.trim();
                  if (seenText) {
                    seenCount = parseInt(seenText.replace(/,/g, ''), 10) || null;
                  }

                  // Second stat: Win %
                  const winEl = statDivs[1]?.querySelector('.font-bold') || statDivs[1]?.querySelector('.fw-bold');
                  const winText = winEl?.textContent?.trim();
                  if (winText) {
                    winPercentage = parseFloat(winText.replace('%', '')) || null;
                  }

                  // Third stat: Avg banners
                  const avgEl = statDivs[2]?.querySelector('.font-bold') || statDivs[2]?.querySelector('.fw-bold');
                  const avgText = avgEl?.textContent?.trim();
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

          let counterSquads = await runScrape();
          for (let retry = 0; retry < 2 && counterSquads.length === 0; retry++) {
            logger.warn(
              `Counters scrape returned 0 for ${defensiveLeaderBaseId}` +
                `${useSeasonId ? ` (season ${useSeasonId})` : ''} — retry ${retry + 1}/2 after brief settle`
            );
            await new Promise(r => setTimeout(r, 2200));
            try {
              await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 });
            } catch {
              /* ignore */
            }
            counterSquads = await runScrape();
          }

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

