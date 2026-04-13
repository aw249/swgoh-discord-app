import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../utils/logger';

export class BrowserService {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser:', error);
      }
      this.browser = null;
    }
  }

  /**
   * Render HTML content to a PNG image buffer.
   */
  async renderHtml(html: string, viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? 2
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({ type: 'png', fullPage: true });
      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }
}
