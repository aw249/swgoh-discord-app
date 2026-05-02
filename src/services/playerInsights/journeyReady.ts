import { SwgohGgFullPlayerResponse, SwgohGgUnit } from '../../integrations/swgohGgApi';
import { getDisplayRelicLevel } from '../../utils/unitLevelUtils';
import { GameDataService, JourneyRequirement, JourneyPrerequisite } from '../gameDataService';
import { JourneyPrereqStatus, JourneyReadyResult } from './types';

function unitNameFromService(baseId: string, fallback?: string): string {
  const svc = GameDataService.getInstance();
  if (svc.isReady()) {
    const name = svc.getUnitName(baseId);
    if (name && name !== baseId) return name;
  }
  return fallback ?? baseId;
}

function statusFor(req: JourneyPrerequisite, unit: SwgohGgUnit | undefined): { status: JourneyPrereqStatus['status']; shortBy: string } {
  if (!unit) return { status: 'locked', shortBy: 'Not unlocked' };

  if (unit.data.rarity < 7) {
    return { status: 'understarred', shortBy: `★${unit.data.rarity}/7` };
  }

  if (req.kind === 'star') {
    // Star-only requirement: reaching ★N is enough.
    if (unit.data.rarity >= req.value) return { status: 'ready', shortBy: '' };
    return { status: 'understarred', shortBy: `★${unit.data.rarity}/${req.value}` };
  }

  // Relic requirement: implies ★7 + G13 + relic >= value.
  const displayRelic = getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier) ?? 0;
  if (unit.data.gear_level < 13) {
    return { status: 'short', shortBy: `G${unit.data.gear_level}/13` };
  }
  if (displayRelic >= req.value) return { status: 'ready', shortBy: '' };
  return { status: 'short', shortBy: `R${displayRelic}/${req.value}` };
}

export function describeJourneyReady(
  player: SwgohGgFullPlayerResponse,
  requirement: JourneyRequirement,
  glName: string
): JourneyReadyResult {
  const unitsByBaseId = new Map<string, SwgohGgUnit>();
  for (const u of player.units) unitsByBaseId.set(u.data.base_id, u);

  const glUnit = unitsByBaseId.get(requirement.glBaseId);
  const alreadyUnlocked = !!glUnit && glUnit.data.rarity === 7;

  const prerequisites: JourneyPrereqStatus[] = requirement.prerequisites.map(req => {
    const unit = unitsByBaseId.get(req.baseId);
    const { status, shortBy } = statusFor(req, unit);
    return {
      baseId: req.baseId,
      name: unitNameFromService(req.baseId, unit?.data.name),
      requirement: { kind: req.kind, value: req.value },
      current: {
        found: !!unit,
        rarity: unit?.data.rarity ?? 0,
        gearLevel: unit?.data.gear_level ?? 0,
        relicTier: unit ? (getDisplayRelicLevel(unit.data.gear_level, unit.data.relic_tier) ?? 0) : 0,
      },
      status,
      shortBy,
    };
  });

  const readyCount = prerequisites.filter(p => p.status === 'ready').length;

  return {
    glBaseId: requirement.glBaseId,
    glName,
    alreadyUnlocked,
    prerequisites,
    readyCount,
    totalCount: prerequisites.length,
  };
}
