/**
 * Client for fetching GAC bracket data from swgoh.gg
 */
import { logger } from '../../utils/logger';
import { GacBracketData } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';

export class GacBracketClient {
  private readonly baseUrl = 'https://swgoh.gg/api';

  constructor(private readonly browserManager: BrowserManager) {}

  async getGacBracket(allyCode: string): Promise<GacBracketData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/gac-bracket/`;
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data.data;
    } catch (error: any) {
      logger.error(`Error fetching GAC bracket for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('GAC bracket not found. The player may not be in an active GAC bracket.');
      }
      
      if (error.message?.includes('Cloudflare')) {
        throw new Error(
          'Cloudflare challenge could not be resolved. Please try again in a few moments.'
        );
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch GAC bracket: ${error.message}`);
      }
      
      throw new Error('Failed to fetch GAC bracket. Please try again later.');
    }
  }
}

