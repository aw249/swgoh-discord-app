/**
 * Type definitions for swgoh.gg API responses and data structures
 */

export interface GacBracketPlayer {
  ally_code: number;
  /** Comlink player ID — present when bracket data originates from Comlink, absent for swgoh.gg-only data */
  player_id?: string;
  player_level: number;
  player_name: string;
  player_skill_rating: number | null;
  player_gp: number;
  /** Top 80 character GP - used for GAC Round 1 matchmaking */
  top80_character_gp?: number;
  guild_id: string;
  guild_name: string;
  bracket_rank: number;
  bracket_score: number;
}

export interface GacBracketData {
  start_time: string;
  league: string;
  season_id: string;
  season_number: number;
  event_id: string;
  bracket_id: number;
  bracket_players: GacBracketPlayer[];
}

export interface GacBracketResponse {
  data: GacBracketData;
  message: string | null;
  total_count: number | null;
}

export interface SwgohGgPlayerData {
  ally_code: number;
  name: string;
  level: number;
  galactic_power: number;
  character_galactic_power: number;
  ship_galactic_power: number;
  skill_rating: number;
  league_name: string;
  guild_name: string;
  last_updated: string;
  arena_rank?: number;
  arena_leader_base_id?: string;
  fleet_arena?: {
    rank: number;
    leader: string;
  };
  guild_id?: string;
  season_full_clears?: number;
  season_successful_defends?: number;
  season_offensive_battles_won?: number;
  season_undersized_squad_wins?: number;
}

export interface SwgohGgUnitStats {
  '1'?: number; // Health
  '2'?: number;
  '3'?: number;
  '4'?: number;
  '5'?: number; // Speed
  '6'?: number; // Physical Damage
  '7'?: number; // Special Damage
  '8'?: number; // Armor
  '9'?: number;
  '10'?: number; // Armor Penetration
  '11'?: number;
  '12'?: number;
  '13'?: number;
  '14'?: number; // Physical Crit Chance
  '15'?: number; // Special Crit Chance
  '16'?: number; // Crit Damage
  '17'?: number; // Potency
  '18'?: number; // Tenacity
  '27'?: number; // Health Steal
  '28'?: number; // Protection
}

export interface SwgohGgUnitStatDiffs {
  '1'?: number; // Health diff
  '5'?: number; // Speed diff (bonus from mods)
  '6'?: number; // Physical Damage diff
  '7'?: number; // Special Damage diff
  '8'?: number; // Armor diff
  '9'?: number;
  '17'?: number; // Potency diff
  '18'?: number; // Tenacity diff
  '28'?: number; // Protection diff
}

export interface SwgohGgUnit {
  data: {
    base_id: string;
    name: string;
    gear_level: number;
    level: number;
    power: number;
    rarity: number;
    stats: SwgohGgUnitStats;
    stat_diffs?: SwgohGgUnitStatDiffs;
    relic_tier: number | null;
    is_galactic_legend: boolean;
    combat_type: number; // 1 = character, 2 = ship
    mod_set_ids: string[];
    zeta_abilities: string[];
    omicron_abilities: string[];
  };
}

export interface SwgohGgMod {
  id: string;
  level: number;
  tier: number;
  rarity: number;
  set: string;
  slot: number;
  primary_stat?: {
    name: string;
    stat_id: number;
    value: number;
    display_value: string;
  };
  secondary_stats?: Array<{
    name: string;
    stat_id: number;
    value: number;
    display_value: string;
    roll?: number;
  }>;
  character?: string;
  reroll_count?: number;
}

export interface SwgohGgFullPlayerResponse {
  data: SwgohGgPlayerData;
  units: SwgohGgUnit[];
  mods?: SwgohGgMod[];
}

export interface GacDefensiveSquadUnit {
  baseId: string;
  relicLevel: number | null;
  portraitUrl: string | null;
}

export interface GacDefensiveSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
}

export interface GacCounterSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
  winPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
}

export interface GacTopDefenseSquad {
  leader: GacDefensiveSquadUnit;
  members: GacDefensiveSquadUnit[];
  holdPercentage: number | null;
  seenCount: number | null;
  avgBanners: number | null;
}

