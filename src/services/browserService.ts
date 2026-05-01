import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../utils/logger';

const DEFAULT_DEVICE_SCALE_FACTOR = parseFloat(process.env.DEVICE_SCALE_FACTOR || '2');
const BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PAGE_TIMEOUT_MS = 30 * 1000; // 30 seconds per page operation

// Chromium's hard cap on a single screenshot surface is 16384px per dimension,
// measured in *device* pixels (CSS px × deviceScaleFactor). A request larger
// than this is silently truncated — you get a PNG cut off mid-content with no
// error. Before this constant is compared against anything, make sure you're
// in the right pixel space.
const CHROMIUM_MAX_DEVICE_PX = 16384;

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
      this.browser.on('disconnected', () => {
        logger.warn('Browser process disconnected unexpectedly');
        this.browser = null;
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
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
   *
   * The `height` in `viewport` is treated as a *hint* for the initial layout
   * viewport (e.g. for responsive CSS), not the screenshot height. The actual
   * screenshot is clipped to the measured content height, which avoids
   * Puppeteer's tiled-fullPage capture path entirely. That path is the source
   * of the "duplicated content" bug: when `fullPage: true` is combined with
   * a fixed `setViewport` height, Chromium captures in two passes and stitches
   * them together — and if layout reflows between passes (images loading
   * after `networkidle0`, font swaps, etc.), the second pass ends up showing
   * the top of the page again instead of the bottom.
   */
  async renderHtml(
    html: string,
    viewport: { width: number; height: number; deviceScaleFactor?: number }
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);

      const deviceScaleFactor = viewport.deviceScaleFactor ?? DEFAULT_DEVICE_SCALE_FACTOR;

      // Initial viewport: use the caller's width for correct CSS layout. Height
      // is a hint only — pick a small-ish value so fonts/media queries behave
      // as if the page is scrollable rather than huge. Final height is
      // measured from the content after load.
      await page.setViewport({
        width: viewport.width,
        height: Math.min(viewport.height, 1200),
        deviceScaleFactor
      });

      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Wait for layout to actually settle. `networkidle0` only tracks the
      // network; fonts and <img> elements without explicit width/height
      // attributes can reflow the page after that point. Screenshotting
      // before reflow is what causes Chromium's tiled capture to desync.
      // Note: the callback runs in the browser context; DOM types aren't
      // in the Node tsconfig's lib, hence the `any` casts.
      await page.evaluate(async () => {
        const g = globalThis as any;
        const doc = g.document;

        // Fonts (best-effort; older Chromium builds may not expose this)
        if (doc.fonts?.ready) {
          await doc.fonts.ready;
        }

        // All <img> elements
        const images: any[] = Array.from(doc.images);
        await Promise.all(
          images.map((img: any) => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>(resolve => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            });
          })
        );

        // One more frame so any post-load layout lands before we measure
        await new Promise<void>(resolve => g.requestAnimationFrame(() => resolve()));
      });

      // Measure final content height. Use the larger of scrollHeight,
      // offsetHeight and bounding rect height to be safe.
      const contentHeight = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const body = doc.body;
        const htmlEl = doc.documentElement;
        return Math.max(
          body.scrollHeight,
          body.offsetHeight,
          htmlEl.clientHeight,
          htmlEl.scrollHeight,
          htmlEl.offsetHeight,
          Math.ceil(body.getBoundingClientRect().height)
        );
      });

      // Pick the largest deviceScaleFactor that keeps both dimensions under
      // Chromium's 16384 device-px ceiling. If the caller asked for DSF=2 but
      // the content is tall enough that width×2 or height×2 would overflow,
      // drop DSF just enough to fit. Fractional DSFs are accepted by
      // Puppeteer. Clamp to ≥1 so we never upscale beyond what was requested.
      const headroomForHeight = CHROMIUM_MAX_DEVICE_PX / Math.max(contentHeight, 1);
      const headroomForWidth = CHROMIUM_MAX_DEVICE_PX / Math.max(viewport.width, 1);
      const effectiveDSF = Math.max(
        1,
        Math.min(deviceScaleFactor, headroomForHeight, headroomForWidth)
      );

      if (effectiveDSF < deviceScaleFactor) {
        logger.warn(
          `Reducing deviceScaleFactor from ${deviceScaleFactor} to ${effectiveDSF.toFixed(2)} ` +
          `to keep ${viewport.width}x${contentHeight} CSS px under Chromium's ` +
          `${CHROMIUM_MAX_DEVICE_PX}px device-pixel surface limit.`
        );
      }

      // Even at DSF=1, content taller than 16384 CSS px can't fit on a single
      // surface. Clip height to what's renderable and warn.
      const maxHeightAtEffectiveDSF = Math.floor(CHROMIUM_MAX_DEVICE_PX / effectiveDSF);
      const clampedHeight = Math.min(contentHeight, maxHeightAtEffectiveDSF);
      if (clampedHeight < contentHeight) {
        logger.warn(
          `Content height (${contentHeight}px) exceeds renderable max ` +
          `(${maxHeightAtEffectiveDSF}px at DSF ${effectiveDSF.toFixed(2)}); ` +
          `screenshot will be clipped.`
        );
      }

      // Resize viewport to match content height exactly. This prevents any
      // tiled-capture path and avoids scroll-driven reflow.
      await page.setViewport({
        width: viewport.width,
        height: clampedHeight,
        deviceScaleFactor: effectiveDSF
      });

      // Clip-based screenshot rather than fullPage. This is the single most
      // important change — `fullPage: true` is the code path that duplicates
      // content on tall pages.
      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: viewport.width, height: clampedHeight }
      });

      return screenshot as Buffer;
    } finally {
      await page.close();
    }
  }
}
