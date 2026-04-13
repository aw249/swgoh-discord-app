/**
 * BrowserService tests.
 *
 * We mock puppeteer at the module level. Because jest.mock factories are
 * hoisted to the top of the file by Babel/ts-jest, any variables referenced
 * inside the factory must themselves be defined inside the factory (or via
 * jest.fn() with a separate spy reference obtained after the mock is set up).
 * We use module-level jest.fn() stubs that are assigned values once inside
 * beforeEach so the implementation can be changed per test.
 */

import { BrowserService } from '../browserService';

// ---------------------------------------------------------------------------
// Build reusable mock objects INSIDE jest.mock factory to avoid hoisting issues
// ---------------------------------------------------------------------------

jest.mock('puppeteer', () => {
  const mockPageClose = jest.fn().mockResolvedValue(undefined);
  const mockSetDefaultTimeout = jest.fn();
  const mockSetViewport = jest.fn().mockResolvedValue(undefined);
  const mockSetContent = jest.fn().mockResolvedValue(undefined);
  const mockScreenshot = jest.fn().mockResolvedValue(Buffer.from('fake-png'));

  const mockPage = {
    setDefaultTimeout: mockSetDefaultTimeout,
    setViewport: mockSetViewport,
    setContent: mockSetContent,
    screenshot: mockScreenshot,
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

// Get a handle on the mocked module so we can inspect calls
import puppeteer from 'puppeteer';

// ---------------------------------------------------------------------------
// Helpers to retrieve deeply nested mocks from the mocked module
// ---------------------------------------------------------------------------

async function launchMockBrowser() {
  // Calling through the mock returns our fake browser object
  return (puppeteer.launch as jest.Mock).mock.results[
    (puppeteer.launch as jest.Mock).mock.results.length - 1
  ]?.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserService', () => {
  let service: BrowserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BrowserService();
  });

  afterEach(async () => {
    await service.close();
  });

  // -------------------------------------------------------------------------
  // close() on a fresh instance doesn't throw
  // -------------------------------------------------------------------------

  it('close() on a fresh instance does not throw', async () => {
    await expect(service.close()).resolves.toBeUndefined();
    // Browser was never launched so puppeteer.launch should never be called
    expect((puppeteer.launch as jest.Mock)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // renderHtml calls page methods in the correct order
  // -------------------------------------------------------------------------

  it('renderHtml calls setViewport, setContent, and screenshot', async () => {
    const html = '<html><body>Hello</body></html>';
    const viewport = { width: 800, height: 600 };

    const buffer = await service.renderHtml(html, viewport);

    // Retrieve the page mock via the browser that was launched
    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 })
    );
    expect(page.setContent).toHaveBeenCalledWith(html, { waitUntil: 'networkidle0' });
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  // -------------------------------------------------------------------------
  // Default deviceScaleFactor is applied when not specified
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // close() calls browser.close() after a browser has been launched
  // -------------------------------------------------------------------------

  it('close() calls browser.close() after a browser has been used', async () => {
    await service.renderHtml('<html></html>', { width: 100, height: 100 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;

    await service.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // page.close() is called in the finally block
  // -------------------------------------------------------------------------

  it('page.close() is called after renderHtml (cleanup in finally block)', async () => {
    await service.renderHtml('<html></html>', { width: 100, height: 100 });

    const browser = await (puppeteer.launch as jest.Mock).mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;

    expect(page.close).toHaveBeenCalled();
  });
});
