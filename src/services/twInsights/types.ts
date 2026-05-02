import { GuildSnapshot } from '../guildInsights/types';

export interface ScoutSnapshot {
  guild: GuildSnapshot;
  recentTwPattern: Array<'win' | 'loss' | 'unknown'>;
  twAvailable: boolean;
}
