/**
 * Client for fetching GAC bracket data from swgoh.gg
 */
import { GacBracketData } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

export class GacBracketClient {
  private readonly baseUrl = API_ENDPOINTS.SWGOH_GG_API;

  constructor(private readonly browserManager: BrowserManager) {}

  async getGacBracket(allyCode: string): Promise<GacBracketData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/gac-bracket/`;
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('No active GAC bracket found - player may not be in an active GAC event');
      }
      
      return data.data;
    } catch (error: any) {
      // Don't log here - let callers decide how to handle/log based on context
      // (e.g. warmup errors should be silent, user commands should show friendly errors)
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('GAC bracket not found - player may not be in an active GAC event');
      }
      
      if (error.message?.includes('Cloudflare')) {
        throw new Error('Cloudflare challenge could not be resolved - please try again later');
      }
      
      if (error.message?.includes('No active GAC bracket')) {
        throw error; // Re-throw as-is, it's already a friendly message
      }
      
      throw new Error(`Failed to fetch GAC bracket: ${error.message || 'Unknown error'}`);
    }
  }
}

