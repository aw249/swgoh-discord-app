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
});
