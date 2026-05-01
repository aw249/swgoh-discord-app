import { BrowserService } from './browserService';
import { ReadyCheckRow, GuildCompareSummary } from './guildInsights/types';
import { compareHtml } from './guildImages/templates/compareTemplate';
import { readyCheckHtml } from './guildImages/templates/readyCheckTemplate';

export class GuildImageService {
  private readonly browser = new BrowserService();

  async renderCompare(summary: GuildCompareSummary): Promise<Buffer> {
    return this.browser.renderHtml(compareHtml(summary), { width: 1100, height: 1200 });
  }

  async renderReadyCheck(rows: ReadyCheckRow[], guildName: string, unitName: string, minRelic: number): Promise<Buffer> {
    return this.browser.renderHtml(readyCheckHtml(rows, guildName, unitName, minRelic), { width: 900, height: 1200 });
  }

  async close(): Promise<void> { await this.browser.close(); }
}
