export interface UnitReadyState {
  baseId: string;
  name: string;
  found: boolean;
  rarity: number;
  level: number;
  gearLevel: number;
  relicTier: number;
  zetaCount: number;
  omicronCount: number;
  nextStepHint: string;
}

/** Per-prerequisite result for /player journey-ready. */
export interface JourneyPrereqStatus {
  baseId: string;
  name: string;
  /** What the journey requires. */
  requirement: { kind: 'relic' | 'star'; value: number };
  /** What the player has now. found=false → unit not unlocked at all. */
  current: { found: boolean; rarity: number; gearLevel: number; relicTier: number };
  /** Aggregate status. */
  status: 'ready' | 'short' | 'locked' | 'understarred';
  /** Why-not text, populated when status !== 'ready'. Empty otherwise. */
  shortBy: string;
}

export interface JourneyReadyResult {
  glBaseId: string;
  glName: string;
  /** True when the player already owns the GL (rarity === 7). */
  alreadyUnlocked: boolean;
  prerequisites: JourneyPrereqStatus[];
  readyCount: number;
  totalCount: number;
}
