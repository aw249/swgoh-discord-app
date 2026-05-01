import { ComlinkGuildData } from '../../integrations/comlink/comlinkClient';
import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { countGuildGalacticLegends } from './glCount';
import { GuildSnapshot, GuildCompareSummary } from './types';

const TOP_MEMBERS = 10;

export function buildGuildSnapshot(
  guild: ComlinkGuildData,
  roster: Map<string, SwgohGgFullPlayerResponse>
): GuildSnapshot {
  const profile = guild.guild.profile;
  const gpRaw = parseInt(profile.guildGalacticPower, 10);

  // Derive top members from the fan-out roster — guild.guild.member entries
  // have stripped name/GP without HMAC auth.
  const topMembers = Array.from(roster.values())
    .map(p => ({ name: p.data.name, galacticPower: p.data.galactic_power }))
    .sort((a, b) => b.galacticPower - a.galacticPower)
    .slice(0, TOP_MEMBERS);

  return {
    id: profile.id,
    name: profile.name,
    memberCount: profile.memberCount,
    guildGalacticPower: Number.isFinite(gpRaw) ? gpRaw : 0,
    glCount: countGuildGalacticLegends(roster),
    topMembers,
  };
}

export function buildCompareSummary(
  guildA: ComlinkGuildData, rosterA: Map<string, SwgohGgFullPlayerResponse>,
  guildB: ComlinkGuildData, rosterB: Map<string, SwgohGgFullPlayerResponse>
): GuildCompareSummary {
  const a = buildGuildSnapshot(guildA, rosterA);
  const b = buildGuildSnapshot(guildB, rosterB);
  return {
    a, b,
    gpDelta: a.guildGalacticPower - b.guildGalacticPower,
    memberDelta: a.memberCount - b.memberCount,
    glDelta: a.glCount.total - b.glCount.total,
  };
}
