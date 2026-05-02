import { BrowserService } from './browserService';
import { ScoutSnapshot } from './twInsights/types';
import { scoutHtml } from './twImages/templates/scoutTemplate';

export class TwImageService {
  private readonly browser = new BrowserService();

  async renderScout(snapshot: ScoutSnapshot): Promise<Buffer> {
    return this.browser.renderHtml(scoutHtml(snapshot), { width: 800, height: 1100 });
  }

  async close(): Promise<void> { await this.browser.close(); }
}
