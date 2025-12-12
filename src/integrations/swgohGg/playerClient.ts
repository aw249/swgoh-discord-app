/**
 * Client for fetching player data from swgoh.gg
 */
import { logger } from '../../utils/logger';
import { SwgohGgPlayerData, SwgohGgFullPlayerResponse } from '../../types/swgohGgTypes';
import { BrowserManager } from './browser';

export class PlayerClient {
  private readonly baseUrl = 'https://swgoh.gg/api';

  constructor(private readonly browserManager: BrowserManager) {}

  async getPlayer(allyCode: string): Promise<SwgohGgPlayerData> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/`;
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data.data;
    } catch (error: any) {
      logger.error(`Error fetching player data for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('Player not found. Please check the ally code.');
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch player data: ${error.message}`);
      }
      
      throw new Error('Failed to fetch player data. Please try again later.');
    }
  }

  async getFullPlayer(allyCode: string): Promise<SwgohGgFullPlayerResponse> {
    try {
      const url = `${this.baseUrl}/player/${allyCode}/`;
      
      const data = await this.browserManager.fetchWithPuppeteer(url);
      
      if (!data || !data.data) {
        throw new Error('Invalid response format from swgoh.gg API');
      }
      
      return data as SwgohGgFullPlayerResponse;
    } catch (error: any) {
      logger.error(`Error fetching full player data for ally code ${allyCode}:`, error);
      
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error('Player not found. Please check the ally code.');
      }
      
      if (error.message) {
        throw new Error(`Failed to fetch player data: ${error.message}`);
      }
      
      throw new Error('Failed to fetch player data. Please try again later.');
    }
  }
}

