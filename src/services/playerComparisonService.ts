import puppeteer, { Browser } from 'puppeteer';
import { SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import { generateHTML } from './playerComparison/htmlGeneration';
import { getCharacterPortraitUrl } from '../config/characterPortraits';
import { getGalacticLegendIds } from './playerComparison/utils';

export class PlayerComparisonService {
  private browser: Browser | null = null;

  constructor() {
    // Browser will be created on demand
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });
      // Clean up reference if browser process crashes
      this.browser.on('disconnected', () => {
        logger.warn('PlayerComparisonService: Browser process disconnected unexpectedly');
        this.browser = null;
      });
    }
    return this.browser;
  }

  /**
   * Build character image cache using existing portrait URLs from our cache.
   * Uses GameDataService to get all GL IDs dynamically.
   */
  private buildCharacterImageCache(): Map<string, string> {
    const cache = new Map<string, string>();
    
    // Get GL IDs dynamically from GameDataService
    const glIds = getGalacticLegendIds();
    
    for (const glId of glIds) {
      const url = getCharacterPortraitUrl(glId);
      if (url) {
        cache.set(glId, url);
      }
    }
    
    logger.debug(`Built character image cache with ${cache.size} GL portraits (${glIds.length} GLs detected)`);
    return cache;
  }

  async generateComparisonImage(
    p1: SwgohGgFullPlayerResponse,
    p2: SwgohGgFullPlayerResponse
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Build character image cache from existing portraits
      const characterImageCache = this.buildCharacterImageCache();
      
      // Set a smaller initial viewport - we'll clip to the actual content
      await page.setViewport({
        width: 1000,
        height: 800,
        deviceScaleFactor: 2
      });

      // Generate and set the HTML content
      const html = generateHTML(p1, p2, characterImageCache);
      await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
      
      // Wait for images to load
      await page.evaluate(`
        Promise.all(
          Array.from(document.images)
            .filter(img => !img.complete)
            .map(img => new Promise(resolve => {
              img.onload = img.onerror = resolve;
            }))
        )
      `);
      
      // Give a short delay for any final rendering
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get the bounding box of the container to clip the screenshot
      const containerBox = await page.evaluate(`
        (() => {
          const container = document.querySelector('.container');
          if (!container) return null;
          const rect = container.getBoundingClientRect();
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          };
        })()
      `) as { x: number; y: number; width: number; height: number } | null;

      // Take screenshot - clip to container if found, otherwise use fullPage
      let screenshot: Buffer;
      if (containerBox) {
        // Add padding around the container
        const padding = 20;
        screenshot = await page.screenshot({
          type: 'png',
          clip: {
            x: Math.max(0, containerBox.x - padding),
            y: Math.max(0, containerBox.y - padding),
            width: containerBox.width + (padding * 2),
            height: containerBox.height + (padding * 2)
          }
        }) as Buffer;
      } else {
        screenshot = await page.screenshot({
          type: 'png',
          fullPage: true
        }) as Buffer;
      }

      return screenshot;
    } finally {
      await page.close();
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser:', error);
      }
      this.browser = null;
    }
  }
}
