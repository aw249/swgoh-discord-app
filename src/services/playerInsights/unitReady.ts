import { SwgohGgFullPlayerResponse } from '../../integrations/swgohGgApi';
import { UnitReadyState } from './types';

const MAX_GEAR = 13;
const MAX_RELIC = 9;

export function describeUnitReady(
  player: SwgohGgFullPlayerResponse,
  baseId: string
): UnitReadyState {
  const unit = player.units.find(u => u.data.base_id === baseId);

  if (!unit) {
    return {
      baseId, name: baseId, found: false,
      rarity: 0, level: 0, gearLevel: 0, relicTier: 0,
      zetaCount: 0, omicronCount: 0,
      nextStepHint: 'Unit not unlocked yet.',
    };
  }

  const gearLevel = unit.data.gear_level;
  const relicTier = unit.data.relic_tier ?? 0;

  let nextStepHint: string;
  if (gearLevel < MAX_GEAR) {
    nextStepHint = `Push to Gear ${MAX_GEAR} (currently G${gearLevel}).`;
  } else if (relicTier < MAX_RELIC) {
    nextStepHint = `At Gear 13 — climb to Relic ${MAX_RELIC} (currently R${relicTier}).`;
  } else {
    nextStepHint = 'Fully geared at G13/R9 — squad mods, ability tiers, and datacrons next.';
  }

  return {
    baseId,
    name: unit.data.name,
    found: true,
    rarity: unit.data.rarity,
    level: unit.data.level,
    gearLevel,
    relicTier,
    zetaCount: unit.data.zeta_abilities.length,
    omicronCount: unit.data.omicron_abilities.length,
    nextStepHint,
  };
}
