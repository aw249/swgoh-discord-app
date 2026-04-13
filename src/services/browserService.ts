import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../utils/logger';

const DEFAULT_DEVICE_SCALE_FACTOR = parseFloat(process.env.DEVICE_SCALE_FACTOR || '2');
const BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PAGE_TIMEOUT_MS = 30 * 1000; // 30 seconds per page operation

export class BrowserService {
  private browser: Browser | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      logger.info('Browser idle timeout reached, closing browser');
      this.close().catch(err => logger.warn('Error closing idle browser:', err));
    }, BROWSER_IDLE_TIMEOUT_MS);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    this.resetIdleTimer();
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
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
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE_FACTOR
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot({ type: 'png', fullPage: true });
      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }
}
