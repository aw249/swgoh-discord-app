import { CombinedApiClient } from '../integrations/comlink';
import { ComlinkGuildData, ComlinkPlayerData } from '../integrations/comlink/comlinkClient';
import { SwgohGgFullPlayerResponse } from '../integrations/swgohGgApi';
import { GuildRosterCache } from './guildRosterCache';
import { GuildLookupResult, GuildLookupRow, isLikelyGuildId, summariseLookup } from './guildInsights';
import { logger } from '../utils/logger';

const FAN_OUT_CONCURRENCY = 8;

interface SearchPayload {
  guild?: Array<{ id: string; name: string; memberCount: number; guildGalacticPower?: string | number }>;
}

export class GuildService {
  constructor(
    private readonly client: CombinedApiClient,
    private readonly cache: GuildRosterCache
  ) {}

  async lookup(query: string): Promise<GuildLookupResult> {
    const trimmed = query.trim();

    if (isLikelyGuildId(trimmed)) {
      const direct = await this.client.getGuild(trimmed, false);
      if (!direct) return { kind: 'empty' };
      return summariseLookup([{
        id: direct.guild.profile.id,
        name: direct.guild.profile.name,
        memberCount: direct.guild.profile.memberCount,
        guildGalacticPower: parseInt(direct.guild.profile.guildGalacticPower, 10) || 0,
      }]);
    }

    const search = (await this.client.searchGuildsByName(trimmed)) as SearchPayload | null;
    if (!search || !Array.isArray(search.guild)) return { kind: 'empty' };

    const candidates: GuildLookupRow[] = search.guild.map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      guildGalacticPower: typeof g.guildGalacticPower === 'string'
        ? parseInt(g.guildGalacticPower, 10) || 0
        : g.guildGalacticPower ?? 0,
    }));
    return summariseLookup(candidates);
  }

  async getGuild(guildId: string, includeRecentActivity = false): Promise<ComlinkGuildData | null> {
    return this.client.getGuild(guildId, includeRecentActivity);
  }

  async resolveCallerGuildId(allyCode: string): Promise<string | null> {
    const player = await this.client.getComlinkClient().getPlayer(allyCode) as ComlinkPlayerData;
    return player.guildId ?? null;
  }

  /**
   * Fan out per-member roster fetch. Two-step per cache miss:
   *   getPlayerById(playerId) → reveals ally code
   *   getFullPlayer(allyCode) → returns SwgohGgFullPlayerResponse
   * Bounded concurrency. Failures on individual members are logged and skipped.
   */
  async getGuildRoster(guild: ComlinkGuildData): Promise<Map<string, SwgohGgFullPlayerResponse>> {
    const guildId = guild.guild.profile.id;
    const out = new Map<string, SwgohGgFullPlayerResponse>();
    const queue = guild.guild.member.slice();

    const work = async (): Promise<void> => {
      while (queue.length > 0) {
        const member = queue.shift();
        if (!member) return;

        const cached = this.cache.get(guildId, member.playerId);
        if (cached) { out.set(member.playerId, cached); continue; }

        try {
          const comlink = await this.client.getComlinkClient().getPlayerById(member.playerId);
          const full = await this.client.getFullPlayer(comlink.allyCode);
          out.set(member.playerId, full);
          this.cache.set(guildId, member.playerId, full);
        } catch (err) {
          logger.warn(`getGuildRoster: failed to fetch member ${member.playerId}:`, err);
        }
      }
    };

    await Promise.all(Array.from({ length: FAN_OUT_CONCURRENCY }, () => work()));
    return out;
  }
}
