import puppeteer, { Browser } from 'puppeteer';
import { SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { logger } from '../utils/logger';
import { generateHTML } from './playerComparison/htmlGeneration';

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
      // Intercept and capture character images from swgoh.gg
      const imageUrls = new Map<string, string>();
      
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('tex.charui_') && url.endsWith('.png')) {
          try {
            const match = url.match(/tex\.charui_([A-Z0-9_]+)\.png/);
            if (match) {
              const baseId = match[1];
              // Convert to base64 for embedding
              const buffer = await response.buffer();
              const base64 = buffer.toString('base64');
              imageUrls.set(baseId, `data:image/png;base64,${base64}`);
            }
          } catch (e) {
            // Ignore errors from failed image captures
          }
        }
      });

      // Navigate to character list to trigger image loading
      await page.goto('https://swgoh.gg/characters/', { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait a bit for images to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.characterImageCache = imageUrls;
      return imageUrls;
    } catch (error) {
      logger.warn('Failed to fetch character images:', error);
      return new Map();
    } finally {
      await page.close();
    }
  }

  async generateComparisonImage(
    p1: SwgohGgFullPlayerResponse,
    p2: SwgohGgFullPlayerResponse
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Fetch character images for the comparison
      await this.fetchCharacterImages();
      
      // Set viewport for the comparison image
      await page.setViewport({
        width: 1200,
        height: 1600,
        deviceScaleFactor: 2
      });

      // Generate and set the HTML content
      const html = generateHTML(p1, p2, this.characterImageCache);
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Take screenshot
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      return screenshot as Buffer;
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
