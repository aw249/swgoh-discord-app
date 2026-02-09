/**
 * Client for fetching player data from swgoh.gg
 */
import { logger } from '../../utils/logger';
import { SwgohGgPlayerData, SwgohGgFullPlayerResponse } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';
import { batchUpdatePortraitUrls, reloadCache } from '../../storage/characterPortraitCache';

export class PlayerClient {
  private readonly baseUrl = 'https://swgoh.gg/api';
  private readonly profileBaseUrl = 'https://swgoh.gg/player';

  constructor(private readonly browserManager: BrowserManager) {}

  async getPlayer(allyCode: string): Promise<SwgohGgPlayerData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/`;
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
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
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      const playerData = data as SwgohGgFullPlayerResponse;
      
      // Extract portrait URLs from the player's profile page and update cache
      // Run this in the background with a timeout to avoid blocking the response
      // Portraits are optional - we'll use fallback pattern if extraction fails
      this.extractPortraitsFromProfile(allyCode, playerData)
        .then(() => {
          logger.debug(`Successfully extracted portraits for ${allyCode}`);
        })
        .catch(err => {
          // Log but don't fail - portraits are optional
          logger.debug(`Portrait extraction for ${allyCode} failed or timed out (this is OK):`, err);
        });
      
      return playerData;
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
   * Extract character portrait URLs from the player's profile page.
   * This scrapes the HTML to find portrait URLs for all characters in the roster.
   */
  private async extractPortraitsFromProfile(
    allyCode: string,
    playerData: SwgohGgFullPlayerResponse
  ): Promise<void> {
    // Use Promise.race to add a timeout so this doesn't hang forever
    const extractionPromise = this.browserManager.queueOperation(async () => {
      const page = await this.browserManager.createPage();
      
      try {
        const profileUrl = `${this.profileBaseUrl}/${allyCode}/`;
        logger.debug(`Extracting portraits from ${profileUrl}`);
        
        await page.goto(profileUrl, {
          waitUntil: 'networkidle2',
          timeout: 20000  // Reduced timeout
        });

        // Wait a bit for images to load
        await new Promise(resolve => setTimeout(resolve, 1000));  // Reduced wait time

          // Extract portrait URLs from the roster on the profile page
          const portraitMappings = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc: any = (globalThis as any).document;
            const mappings: Array<{ baseId: string; portraitUrl: string | null }> = [];
            const seenBaseIds = new Set<string>();
            
            // Try multiple selectors to find character portraits
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const selectors = [
              '.character-portrait[data-unit-def-tooltip-app]',
              '[data-unit-def-tooltip-app]',
              '.character-portrait',
              'img[data-unit-def-tooltip-app]'
            ];
            
            for (const selector of selectors) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const elements = Array.from(doc.querySelectorAll(selector)) as any[];
              
              for (const element of elements) {
                const baseId = element.getAttribute('data-unit-def-tooltip-app') as string | null;
                if (!baseId || seenBaseIds.has(baseId)) continue;
                
                seenBaseIds.add(baseId);
                
                // Try to find the image element - could be the element itself or a child
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let img: any = null;
                let portraitUrl: string | null = null;
                
                // If element is an img, use it directly
                if (element.tagName === 'IMG') {
                  img = element;
                } else {
                  // Otherwise look for img child
                  img = element.querySelector('img') || element.querySelector('.character-portrait__img');
                }
                
                if (img) {
                  portraitUrl = img.src || img.getAttribute('src') || img.getAttribute('data-src');
                  
                  // Make sure it's a full URL
                  if (portraitUrl && !portraitUrl.startsWith('http')) {
                    if (portraitUrl.startsWith('//')) {
                      portraitUrl = 'https:' + portraitUrl;
                    } else if (portraitUrl.startsWith('/')) {
                      portraitUrl = 'https://swgoh.gg' + portraitUrl;
                    }
                  }
                }
                
                if (portraitUrl && portraitUrl.includes('charui')) {
                  mappings.push({ baseId, portraitUrl });
                }
              }
            }
            
            return mappings;
          });

          if (portraitMappings.length > 0) {
            await batchUpdatePortraitUrls(portraitMappings);
            // Reload cache to ensure it's fresh for immediate use
            await reloadCache();
            logger.info(`Extracted ${portraitMappings.length} portrait URLs from profile for ${allyCode}`);
          } else {
            logger.debug(`No portrait URLs found on profile page for ${allyCode}`);
          }
        } finally {
          await page.close();
        }
      });
    
    // Add a timeout to prevent hanging
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Portrait extraction timeout')), 25000); // 25 second timeout
    });
    
    try {
      await Promise.race([extractionPromise, timeoutPromise]);
    } catch (error) {
      // Log error but don't fail - this is a background operation
      logger.debug(`Portrait extraction for ${allyCode} failed or timed out:`, error);
      throw error;
    }
  }
}

