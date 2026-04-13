/**
 * Utility functions for player comparison
 */
import { SwgohGgFullPlayerResponse, SwgohGgUnit } from '../../integrations/swgohGgApi';
import { gameDataService } from '../gameDataService';
import { STAT_IDS } from '../../config/imageConstants';

/**
 * Get Galactic Legend IDs dynamically from GameDataService.
 * Falls back to a static list if GameDataService is not ready.
 */
export function getGalacticLegendIds(): string[] {
  if (gameDataService.isReady()) {
    return gameDataService.getAllGalacticLegends();
  }
  // Fallback static list
  return [
    'GLREY', 'SUPREMELEADERKYLOREN', 'GRANDMASTERLUKE', 'SITHPALPATINE',
    'JEDIMASTERKENOBI', 'LORDVADER', 'JABBATHEHUTT', 'GLLEIA',
    'GLAHSOKATANO', 'GLHONDO'
  ];
}

/**
 * @deprecated Use getGalacticLegendIds() instead
 */
export const GALACTIC_LEGEND_IDS = [
  'GLREY',
  'SUPREMELEADERKYLOREN',
  'GRANDMASTERLUKE',
  'SITHPALPATINE',
  'JEDIMASTERKENOBI',
  'LORDVADER',
  'JABBATHEHUTT',
  'GLLEIA',
  'GLAHSOKATANO',
  'GLHONDO'
];

export function getGLStats(u: SwgohGgUnit) {
    const s = u.data.stats;
    const d = u.data.stat_diffs || {};

    const speed = Math.round(s[STAT_IDS.SPEED] || 0);
    const speedBonus = Math.round(d[STAT_IDS.SPEED] || 0);

    const health = (s[STAT_IDS.HEALTH] || 0) / 1000; // Keep as decimal for formatting
    const protection = (s[STAT_IDS.PROTECTION] || 0) / 1000; // Keep as decimal for formatting
    const offense = Math.round(s['6'] || 0);
    const potency = Math.round((s['17'] || 0) * 100); // Potency as percentage
    const tenacity = Math.round((s['18'] || 0) * 100); // Tenacity as percentage

    return {
      speed: { total: speed, bonus: speedBonus },
      health,
      protection,
      offense,
      potency,
      tenacity
    };
  }

export function fmt(num: number | undefined | null): string {
    if (!num) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return String(num);
  }

export function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

export function countZetas(player: SwgohGgFullPlayerResponse): number {
    return player.units.reduce((sum, unit) => sum + unit.data.zeta_abilities.length, 0);
  }

export function countOmicrons(player: SwgohGgFullPlayerResponse): number {
    return player.units.reduce((sum, unit) => sum + unit.data.omicron_abilities.length, 0);
  }

export function countGearLevel(player: SwgohGgFullPlayerResponse, level: number): number {
    return player.units.filter(u => u.data.gear_level === level).length;
  }

export function calculateModStats(player: SwgohGgFullPlayerResponse): {
    speed25Plus: number;
    sixDot: number;
    speed20to24: number;
    speed20Plus: number;
    speed15to19: number;
    speed15Plus: number;
    speed10to14: number;
    speed10Plus: number;
  } {
    // Mods are at the root level, not inside data
    const mods = player.mods || [];
    
    // Safety check: if mods array is empty, return zeros
    if (!mods || mods.length === 0) {
      return {
        speed25Plus: 0,
        sixDot: 0,
        speed20to24: 0,
        speed20Plus: 0,
        speed15to19: 0,
        speed15Plus: 0,
        speed10to14: 0,
        speed10Plus: 0
      };
    }
    
    let speed25Plus = 0;
    let sixDot = 0;
    let speed20to24 = 0;
    let speed20Plus = 0;
    let speed15to19 = 0;
    let speed15Plus = 0;
    let speed10to14 = 0;
    let speed10Plus = 0;

    for (const mod of mods) {
      // Check if 6-dot mod (tier 5 and level 15)
      if (mod.tier === 5 && mod.level === 15) {
        sixDot++;
      }

      // Find Speed secondary stat (not primary - we only count secondary stats)
      let speedValue = 0;
      if (mod.secondary_stats && Array.isArray(mod.secondary_stats)) {
        for (const secStat of mod.secondary_stats) {
          // Check by stat_id first (more reliable), then verify name if available
          if (secStat.stat_id === 5) {
            // Verify it's Speed by checking name if available (or if name is missing, assume it's Speed)
            if (!secStat.name || secStat.name === 'Speed' || secStat.name.toLowerCase() === 'speed') {
              // Use display_value if available, otherwise calculate from value
              if (secStat.display_value !== undefined && secStat.display_value !== null) {
                // Parse the display value (e.g., "26", "26.5", or could be a number)
                if (typeof secStat.display_value === 'string') {
                  const cleaned = secStat.display_value.replace(/,/g, '').trim();
                  speedValue = parseFloat(cleaned) || 0;
                } else if (typeof secStat.display_value === 'number') {
                  speedValue = secStat.display_value;
                }
              } else if (secStat.value !== undefined && secStat.value !== null) {
                // Fallback: calculate from value (value is in thousands, e.g., 70000 = 7, 260000 = 26)
                speedValue = secStat.value / 10000;
              }
              
              // Only count one speed secondary per mod
              if (speedValue > 0) {
                break;
              }
            }
          }
        }
      }

      // Categorize by speed value (only count mods with speed >= 10)
      if (speedValue >= 25) {
        speed25Plus++;
        speed20Plus++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 20) {
        speed20to24++;
        speed20Plus++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 15) {
        speed15to19++;
        speed15Plus++;
        speed10Plus++;
      } else if (speedValue >= 10) {
        speed10to14++;
        speed10Plus++;
      }
    }

    return {
      speed25Plus,
      sixDot,
      speed20to24,
      speed20Plus,
      speed15to19,
      speed15Plus,
      speed10to14,
      speed10Plus
    };
  }
