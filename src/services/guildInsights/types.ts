export interface GuildLookupRow {
  id: string;
  name: string;
  memberCount: number;
  guildGalacticPower: number;
}

export interface GuildLookupResult {
  kind: 'profile' | 'list' | 'empty';
  profile?: GuildLookupRow;
  candidates?: GuildLookupRow[];
}

export interface GlBreakdown {
  baseId: string;
  unitName: string;
  count: number;
}

export interface GlCountSummary {
  total: number;
  topByCount: GlBreakdown[];
}

export interface GuildSnapshot {
  id: string;
  name: string;
  memberCount: number;
  guildGalacticPower: number;
  glCount: GlCountSummary;
  topMembers: Array<{ name: string; galacticPower: number }>;
}

export interface GuildCompareSummary {
  a: GuildSnapshot;
  b: GuildSnapshot;
  gpDelta: number;
  memberDelta: number;
  glDelta: number;
}

export interface ReadyCheckRow {
  playerName: string;
  found: boolean;
  rarity: number;
  gearLevel: number;
  /** Display relic level 0-10 (converted via getDisplayRelicLevel) */
  relicTier: number;
  zetaCount: number;
  omicronCount: number;
}
