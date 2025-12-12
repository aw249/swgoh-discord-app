/**
 * Browser utilities for Puppeteer operations with swgoh.gg
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../../utils/logger';
import { RequestQueue } from '../../utils/requestQueue';

// Shared queue for swgoh.gg HTTP / Puppeteer work so that multiple
// Discord commands do not spawn many concurrent heavy browser tasks.
// Start conservatively with a single concurrent task; this can be
// made configurable later if needed.
const swgohGgRequestQueue = new RequestQueue({ maxConcurrency: 1 });

export class BrowserManager {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
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

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Internal implementation for fetching JSON from swgoh.gg via Puppeteer.
   * This should not be called directly; use fetchWithPuppeteer so that
   * calls are queued and concurrency-limited.
   */
  async fetchWithPuppeteerInternal(url: string): Promise<any> {
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
  async fetchWithPuppeteer(url: string): Promise<any> {
    return await swgohGgRequestQueue.add(() => this.fetchWithPuppeteerInternal(url));
  }

  /**
   * Create a new page with standard configuration
   */
  async createPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    return page;
  }

  /**
   * Execute a queued browser operation
   */
  async queueOperation<T>(operation: () => Promise<T>): Promise<T> {
    return await swgohGgRequestQueue.add(operation);
  }
}

