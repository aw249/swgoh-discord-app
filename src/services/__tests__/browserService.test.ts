/**
 * BrowserService tests.
 *
 * We mock puppeteer at the module level. Because jest.mock factories are
 * hoisted to the top of the file by Babel/ts-jest, any variables referenced
 * inside the factory must themselves be defined inside the factory (or via
 * jest.fn() with a separate spy reference obtained after the mock is set up).
 */

import { BrowserService } from '../browserService';

jest.mock('puppeteer', () => {
  const mockPageClose = jest.fn().mockResolvedValue(undefined);
  const mockSetDefaultTimeout = jest.fn();
  const mockSetViewport = jest.fn().mockResolvedValue(undefined);
  const mockSetContent = jest.fn().mockResolvedValue(undefined);
  const mockScreenshot = jest.fn().mockResolvedValue(Buffer.from('fake-png'));
  // page.evaluate is new — used to wait for images/fonts and measure content height.
  // Return a plausible content height so the service can resize the viewport.
  const mockEvaluate = jest.fn().mockImplementation(async () => 1800);

  const mockPage = {
    setDefaultTimeout: mockSetDefaultTimeout,
    setViewport: mockSetViewport,
    setContent: mockSetContent,
    screenshot: mockScreenshot,
    evaluate: mockEvaluate,
    close: mockPageClose,
  };

  const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
  const mockNewPage = jest.fn().mockResolvedValue(mockPage);
  const mockBrowserOn = jest.fn();

  const mockBrowser = {
    newPage: mockNewPage,
    close: mockBrowserClose,
    on: mockBrowserOn,
  };

  const mockLaunch = jest.fn().mockResolvedValue(mockBrowser);

  return {
    __esModule: true,
    default: { launch: mockLaunch },
  };
});

import puppeteer from 'puppeteer';

describe('BrowserService', () => {
  let service: BrowserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrowserService();
  });

  afterEach(async () => {
    await service.close();
  });

  it('close() on a fresh instance does not throw', async () => {
    await expect(service.close()).resolves.toBeUndefined();
    expect((puppeteer.launch as jest.Mock)).not.toHaveBeenCalled();
  });

  it('renderHtml calls setContent with networkidle0 and screenshots with a clip (not fullPage)', async () => {
    const html = '<html><body>Hello</body></html>';
    const viewport = { width: 800, height: 600 };

    const buffer = await service.renderHtml(html, viewport);

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.setContent).toHaveBeenCalledWith(html, { waitUntil: 'networkidle0' });

    // Screenshot is taken with a clip (not fullPage). This is the key change
    // that avoids the tiled-capture duplication bug.
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'png',
        clip: expect.objectContaining({ x: 0, y: 0, width: 800 }),
      })
    );
    expect(page.screenshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true })
    );
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('sets the viewport twice: initial for layout, then resized to measured content height', async () => {
    await service.renderHtml('<html></html>', { width: 800, height: 2400 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    // First call: initial viewport for CSS layout, width matches caller.
    expect(page.setViewport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ width: 800 })
    );

    // Second call: resized to the measured content height (our mock returns 1800).
    expect(page.setViewport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 800, height: 1800 })
    );
  });

  it('uses default deviceScaleFactor when not specified in viewport', async () => {
    const expectedScaleFactor = parseFloat(process.env.DEVICE_SCALE_FACTOR || '2');

    await service.renderHtml('<html></html>', { width: 400, height: 300 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ deviceScaleFactor: expectedScaleFactor })
    );
  });

  it('uses caller-supplied deviceScaleFactor when specified', async () => {
    await service.renderHtml('<html></html>', { width: 400, height: 300, deviceScaleFactor: 3 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ deviceScaleFactor: 3 })
    );
  });

  it('close() calls browser.close() after a browser has been used', async () => {
    await service.renderHtml('<html></html>', { width: 100, height: 100 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;

    await service.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('page.close() is called after renderHtml (cleanup in finally block)', async () => {
    await service.renderHtml('<html></html>', { width: 100, height: 100 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.close).toHaveBeenCalled();
  });

  it('reduces deviceScaleFactor when width × DSF would exceed Chromium 16384 device-px limit', async () => {
    // 10000 CSS wide × DSF=2 = 20000 device px, above Chromium's 16384 ceiling.
    // The service should drop DSF to ~1.6384 so the surface fits.
    await service.renderHtml('<html></html>', {
      width: 10000,
      height: 600,
      deviceScaleFactor: 2,
    });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    // Final (second) setViewport call is the one before screenshot.
    const finalViewport = (page.setViewport as jest.Mock).mock.calls[1][0];
    expect(finalViewport.deviceScaleFactor).toBeCloseTo(16384 / 10000, 3);
    expect(finalViewport.deviceScaleFactor).toBeLessThan(2);
    expect(finalViewport.deviceScaleFactor).toBeGreaterThanOrEqual(1);
  });

  it('reduces deviceScaleFactor when measured content height × DSF would overflow', async () => {
    // Warm up so we can reach the page mock and override evaluate for the
    // next render. Default mock height (1800) fits, so the warm-up render
    // doesn't trigger downscale.
    await service.renderHtml('<html></html>', { width: 800, height: 600 });
    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    // For the next render, evaluate is called twice: once to wait for
    // images/fonts (return value ignored) and once to measure content
    // height. Override both with mockImplementationOnce so we don't leak
    // implementation state into sibling tests.
    (page.evaluate as jest.Mock)
      .mockImplementationOnce(async () => 10000)
      .mockImplementationOnce(async () => 10000);

    (page.setViewport as jest.Mock).mockClear();

    await service.renderHtml('<html></html>', {
      width: 800,
      height: 600,
      deviceScaleFactor: 2,
    });

    const finalViewport = (page.setViewport as jest.Mock).mock.calls[1][0];
    expect(finalViewport.deviceScaleFactor).toBeCloseTo(16384 / 10000, 3);
    expect(finalViewport.deviceScaleFactor).toBeLessThan(2);
    expect(finalViewport.deviceScaleFactor).toBeGreaterThanOrEqual(1);

    // Full content height should be preserved in the clip — no truncation,
    // because the DSF drop buys enough surface headroom.
    expect(finalViewport.height).toBe(10000);
  });
});
