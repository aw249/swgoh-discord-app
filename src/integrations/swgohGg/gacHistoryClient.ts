/**
 * Client for scraping GAC history and defensive squads from swgoh.gg
 */
import { Page } from 'puppeteer';
import { logger } from '../../utils/logger';
import { GacDefensiveSquad, GacDefensiveSquadUnit } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';
import { batchUpdatePortraitUrls } from '../../storage/characterPortraitCache';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

export class GacHistoryClient {
  constructor(private readonly browserManager: BrowserManager) {}

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
            const img = container.querySelector('.character-portrait__img') as any;
            if (img && img.getAttribute) {
              const src = img.getAttribute('src') as string | null;
              if (src) {
                portraitUrl = src;
              }
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
    return await this.browserManager.queueOperation(async () => {
      const page = await this.browserManager.createPage();

      try {
        const historyUrl = `${API_ENDPOINTS.SWGOH_GG_BASE}/p/${allyCode}/gac-history/`;

        // domcontentloaded + bounded content waits — networkidle2 often adds 30–90s on SPAs with analytics.
        page.setDefaultNavigationTimeout(35000);
        page.setDefaultTimeout(35000);

        await page.goto(historyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 35000
        });

        await this.browserManager.settleSwgohGgPageAfterNavigation(page, 60000);

        const title = await page.title();
        if (title.toLowerCase().includes('error')) {
          throw new Error('swgoh.gg returned an error page while loading GAC history.');
        }

        // Wait for GAC history content — `.panel` (2025+ Tailwind) or `.paper` (legacy).
        try {
          await page.waitForFunction(
            () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc: any = (globalThis as any).document;
              const t = doc.title || '';
              if (t.includes('Just a moment')) {
                return false;
              }
              if (doc.querySelector('.panel') || doc.querySelector('.paper')) {
                return true;
              }
              for (const a of Array.from(doc.querySelectorAll('a[href*="/gac-history/"]'))) {
                const href = (a as any).getAttribute('href') || '';
                if (/\/gac-history\/O\d+\/\d+\//.test(href)) {
                  return true;
                }
              }
              const root = doc.querySelector('#root');
              if (root && (root.textContent || '').length > 400) {
                return true;
              }
              return false;
            },
            { timeout: 16000, polling: 200 }
          );

          await page.waitForFunction(
            () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc: any = (globalThis as any).document;
              // 2025+ Tailwind: .panel with .panel__header containing h2
              // Legacy: .paper with h2
              const sections = Array.from(doc.querySelectorAll('.panel, .paper')) as any[];
              for (const section of sections) {
                const h2 = section.querySelector('h2') || section.querySelector('.panel__header h2');
                if (h2 && h2.textContent && h2.textContent.includes('Season')) {
                  return true;
                }
              }
              for (const a of Array.from(doc.querySelectorAll('a[href*="/gac-history/"]'))) {
                const href = (a as any).getAttribute('href') || '';
                if (/\/gac-history\/O\d+\/\d+\//.test(href)) {
                  return true;
                }
              }
              return false;
            },
            { timeout: 6000, polling: 200 }
          ).catch(() => {
            logger.warn(
              'Season headers / GAC round links not detected after secondary wait — page may be empty or layout changed'
            );
          });

          await new Promise(resolve => setTimeout(resolve, 350));
        } catch (error) {
          logger.warn('Error waiting for page content, continuing anyway:', error);
        }

        // Collect event URLs from the latest rounds/events matching the format (limited by maxRounds)
        const eventUrls = await page.evaluate((maxRounds: number, format: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc: any = (globalThis as any).document;
          // 2025+ Tailwind: season sections are .panel elements with .panel__header containing h2
          // Legacy: .paper elements with h2
          const rawBlocks = Array.from(
            doc.querySelectorAll('.panel, .paper')
          ) as any[];
          const papers = rawBlocks.filter(
            (el: any) => !rawBlocks.some((other: any) => other !== el && other.contains(el))
          );

          const anchorMatchesFormat = (anchor: any, fmt: string): boolean => {
            const want = fmt.toLowerCase() === '3v3' ? '(3v3)' : '(5v5)';
            let el: any = anchor.parentElement;
            for (let d = 0; d < 24 && el; d++, el = el.parentElement) {
              const headers = el.querySelectorAll('h1, h2, h3');
              for (let hi = 0; hi < headers.length; hi++) {
                const h = headers[hi];
                const text = ((h.textContent || '') + (h.innerText || '')).toLowerCase();
                if (text.includes('(3v3)') || text.includes('(5v5)')) {
                  return text.includes(want.toLowerCase());
                }
              }
            }
            return true;
          };

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
            // 2025+: h2 is inside .panel__header; legacy: h2 directly in .paper
            const h2 = paper.querySelector('.panel__header h2') || paper.querySelector('h2');
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
            // Fallback 1: Try sections with h2 that have text (might be different format)
            sectionsToProcess = papers.filter((paper: any) => {
              const h2 = paper.querySelector('.panel__header h2') || paper.querySelector('h2');
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

          if (sectionsToProcess.length === 0 && papers.length > 0) {
            sectionsToProcess = papers;
          }
          if (sectionsToProcess.length === 0) {
            sectionsToProcess = [doc.body];
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

          if (allValidHrefs.length === 0) {
            for (const a of Array.from(doc.querySelectorAll('a[href*="/gac-history/"]'))) {
              let href = ((a as any).getAttribute('href') as string) || '';
              const q = href.indexOf('?');
              if (q >= 0) {
                href = href.slice(0, q);
              }
              if (!/\/gac-history\/O\d+\/\d+\//.test(href)) {
                continue;
              }
              if (!anchorMatchesFormat(a, format)) {
                continue;
              }
              let walk: any = a;
              let skipNoData = false;
              for (let i = 0; i < 14 && walk; i++, walk = walk.parentElement) {
                const msg = walk.querySelector && walk.querySelector('.message');
                if (
                  msg &&
                  msg.textContent &&
                  msg.textContent.trim().toLowerCase().includes('no player data')
                ) {
                  skipNoData = true;
                  break;
                }
              }
              if (skipNoData) {
                continue;
              }
              if (!allValidHrefs.includes(href)) {
                allValidHrefs.push(href);
                debugInfo.matchingHrefs++;
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
          
          // Take up to maxRounds rounds to get a more comprehensive view of the player's defensive strategy
          // This includes rounds from the current season and previous seasons of the same format
          const hrefs = parsedUrls.slice(0, maxRounds).map(p => p.href);

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

        // Process multiple rounds to get a more comprehensive view of the player's defensive strategy
        // This includes the current season and looks back at previous seasons of the same format
        // We collect squads from multiple rounds to identify consistent defensive patterns
        logger.info(`Processing up to ${urls.length} GAC event(s) across seasons for ally code ${allyCode}`);
        
        for (const eventUrl of urls) {
          try {
            logger.info(`Scraping GAC event: ${eventUrl}`);
            await page.goto(eventUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 35000
            });

            await this.browserManager.settleSwgohGgPageAfterNavigation(page, 45000);

            try {
              await page.waitForFunction(
                () => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const doc: any = (globalThis as any).document;
                  // Defense tab and portraits must be present for a valid scrape
                  const hasDefenseTab = !!(
                    doc.querySelector('#battles-defense') ||
                    doc.querySelector('.gac-counters-battle-summary__side--defense') ||
                    doc.querySelector('[id*="battles-defense"]')
                  );
                  if (!hasDefenseTab) return false;
                  // Wait for at least one portrait to load within the defense tab
                  const defTab = doc.querySelector('#battles-defense');
                  if (defTab && defTab.querySelectorAll('.character-portrait[data-unit-def-tooltip-app]').length > 0) {
                    return true;
                  }
                  // Fallback: defense tab exists but may still be loading portraits
                  return hasDefenseTab;
                },
                { timeout: 12000, polling: 200 }
              );
            } catch {
              logger.warn(`Defense tab not ready after load: ${eventUrl} — scraping anyway`);
            }
            await new Promise(r => setTimeout(r, 400));

            const squads = await this.scrapeGacEventDefensiveSquads(page);
            
            if (squads.length === 0) {
              logger.warn(`Event ${eventUrl} returned 0 defensive squads`);
              eventsWithoutData.push(eventUrl);
            } else {
              logger.info(`Event ${eventUrl} returned ${squads.length} defensive squad(s)`);
              eventsWithData.push(eventUrl);
              allSquads.push(...squads);
            }
          } catch (error: any) {
            logger.error(`Error scraping event ${eventUrl}:`, error);
            eventsWithoutData.push(eventUrl);
            // Continue to next event instead of failing completely
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
          `Successfully collected ${allSquads.length} defensive squad(s) from ${eventsWithData.length} event(s) ` +
          `across seasons for ally code ${allyCode}. ` +
          `Skipped ${eventsWithoutData.length} event(s) with no data.`
        );

        // Update character portrait cache with any new portraits discovered
        const portraitMappings = allSquads.flatMap(squad => [
          { baseId: squad.leader.baseId, portraitUrl: squad.leader.portraitUrl },
          ...squad.members.map(m => ({ baseId: m.baseId, portraitUrl: m.portraitUrl }))
        ]);
        await batchUpdatePortraitUrls(portraitMappings);

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
}

