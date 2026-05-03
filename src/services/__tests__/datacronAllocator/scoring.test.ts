import {
  scoreCronOnSquad,
  TIER_WEIGHTS,
  LEADER_BONUS_MULTIPLIER,
  T9_CHARACTER_ANCHOR_BONUS,
  STAT_MAGNITUDE_SCALE,
  MAX_STAT_MAGNITUDE_BONUS,
} from '../../datacronAllocator/scoring';
import { DatacronCandidate, DatacronTier, SquadInput } from '../../datacronAllocator/types';
import { ScopeResolver } from '../../datacronAllocator/scopeResolver';

function tier(index: number, opts: Partial<DatacronTier> = {}): DatacronTier {
  return {
    index,
    targetRuleId: opts.targetRuleId ?? '',
    abilityId: opts.abilityId ?? '',
    scopeTargetName: opts.scopeTargetName ?? '',
    hasData: opts.hasData ?? true,
  };
}

function cron(opts: Partial<DatacronCandidate> = {}): DatacronCandidate {
  return {
    source: 'scraped', id: 'c1', setId: 28, focused: true, currentTier: 9, name: 'Test Cron',
    tiers: opts.tiers ?? Array.from({ length: 9 }, (_, i) => tier(i + 1)),
    boxImageUrl: '', calloutImageUrl: '', accumulatedStats: [], ...opts,
  };
}

function squad(memberBaseIds: string[], leaderBaseId: string | null = null, categories: Record<string, string[]> = {}): SquadInput {
  return {
    squadKey: memberBaseIds.join('+'),
    leaderBaseId: leaderBaseId ?? memberBaseIds[0],
    memberBaseIds,
    memberCategories: new Map(Object.entries(categories)),
    side: 'defense',
  };
}

function fakeResolver(charMap: Record<string, string>, catMap: Record<string, string>): ScopeResolver {
  const r = new ScopeResolver();
  jest.spyOn(r, 'resolveScopeTarget').mockImplementation((name: string) => {
    const k = name.toLowerCase();
    if (charMap[k]) return { kind: 'character', baseId: charMap[k] };
    if (catMap[k]) return { kind: 'category', categoryId: catMap[k] };
    return { kind: 'unknown' };
  });
  return r;
}

describe('scoreCronOnSquad', () => {
  it('returns sum of stat-tier weights for a cron with no primaries matching', () => {
    const c = cron();
    const s = squad(['REY']);
    const r = fakeResolver({}, {});
    // 6 stat tiers × 1 = 6
    expect(scoreCronOnSquad(c, s, r)).toBe(6 * TIER_WEIGHTS.stat);
  });

  it('adds tier-3 weight when faction primary matches a squad member', () => {
    const c = cron({
      tiers: [
        tier(1), tier(2),
        tier(3, { targetRuleId: 'target_datacron_darkside', scopeTargetName: 'Dark Side' }),
        tier(4), tier(5), tier(6), tier(7), tier(8), tier(9),
      ],
    });
    const s = squad(['MAUL'], 'MAUL', { MAUL: ['alignment_dark'] });
    const r = fakeResolver({}, { 'dark side': 'alignment_dark' });
    // 6 stat tiers + 1 tier-3 primary
    expect(scoreCronOnSquad(c, s, r)).toBe(6 * TIER_WEIGHTS.stat + TIER_WEIGHTS.primary3);
  });

  it('adds tier-9 weight + leader bonus when tier-9 character is the leader', () => {
    const c = cron({
      tiers: [
        ...Array.from({ length: 8 }, (_, i) => tier(i + 1)),
        tier(9, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
      ],
    });
    const s = squad(['KRRSANTAN', 'CADBANE'], 'KRRSANTAN');
    const r = fakeResolver({ krrsantan: 'KRRSANTAN' }, {});
    // 6 stat tiers + tier-9 × leader-bonus + character-anchor bonus
    expect(scoreCronOnSquad(c, s, r)).toBe(
      6 * TIER_WEIGHTS.stat + TIER_WEIGHTS.primary9 * LEADER_BONUS_MULTIPLIER + T9_CHARACTER_ANCHOR_BONUS
    );
  });

  it('does NOT apply leader bonus when tier-9 character is a sub-member', () => {
    const c = cron({
      tiers: [
        ...Array.from({ length: 8 }, (_, i) => tier(i + 1)),
        tier(9, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
      ],
    });
    const s = squad(['CADBANE', 'KRRSANTAN'], 'CADBANE');
    const r = fakeResolver({ krrsantan: 'KRRSANTAN' }, {});
    // T9 anchor bonus applies whenever the targeted character is in the squad,
    // regardless of leader slot.
    expect(scoreCronOnSquad(c, s, r)).toBe(
      6 * TIER_WEIGHTS.stat + TIER_WEIGHTS.primary9 + T9_CHARACTER_ANCHOR_BONUS
    );
  });

  it('strongly prefers a tier-9 character cron to the squad with that character', () => {
    // Two squads, both dark-side scoundrels. Squad A has KRRSANTAN; squad B does not.
    // A T9 Krrsantan cron must beat the partial-category contributions on squad B
    // by a clear margin so Hungarian assigns it to squad A every time.
    const c = cron({
      tiers: [
        tier(1), tier(2),
        tier(3, { targetRuleId: 'target_datacron_darkside', scopeTargetName: 'Dark Side' }),
        tier(4), tier(5),
        tier(6, { targetRuleId: 'target_datacron_scoundrel', scopeTargetName: 'Scoundrel' }),
        tier(7), tier(8),
        tier(9, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
      ],
    });
    const sWith = squad(['KRRSANTAN', 'CADBANE'], 'CADBANE', {
      KRRSANTAN: ['alignment_dark', 'role_scoundrel'],
      CADBANE: ['alignment_dark', 'role_scoundrel'],
    });
    const sWithout = squad(['BOBAFETT', 'EMBO'], 'BOBAFETT', {
      BOBAFETT: ['alignment_dark', 'role_scoundrel'],
      EMBO: ['alignment_dark', 'role_scoundrel'],
    });
    const r = fakeResolver(
      { krrsantan: 'KRRSANTAN' },
      { 'dark side': 'alignment_dark', scoundrel: 'role_scoundrel' }
    );
    const scoreWith = scoreCronOnSquad(c, sWith, r);
    const scoreWithout = scoreCronOnSquad(c, sWithout, r);
    expect(scoreWith).toBeGreaterThan(scoreWithout);
    // Margin must exceed any plausible swap pressure from another fully-rolled cron.
    expect(scoreWith - scoreWithout).toBeGreaterThanOrEqual(T9_CHARACTER_ANCHOR_BONUS);
  });

  it('does not add tier-9 weight when the targeted character is not on the squad', () => {
    const c = cron({
      tiers: [
        ...Array.from({ length: 8 }, (_, i) => tier(i + 1)),
        tier(9, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
      ],
    });
    const s = squad(['BOBAFETT']);
    const r = fakeResolver({ krrsantan: 'KRRSANTAN' }, {});
    expect(scoreCronOnSquad(c, s, r)).toBe(6 * TIER_WEIGHTS.stat);
  });

  it('caps unfocused crons at tier 6 — tier-9 ability does NOT contribute', () => {
    const c = cron({
      focused: false,
      currentTier: 6,
      tiers: [
        tier(1), tier(2),
        tier(3, { targetRuleId: 'target_datacron_darkside', scopeTargetName: 'Dark Side' }),
        tier(4), tier(5),
        tier(6, { targetRuleId: 'target_datacron_scoundrel', scopeTargetName: 'Scoundrel' }),
        tier(7, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
        tier(8), tier(9),
      ],
    });
    const s = squad(['KRRSANTAN'], 'KRRSANTAN', { KRRSANTAN: ['alignment_dark', 'role_scoundrel'] });
    const r = fakeResolver(
      { krrsantan: 'KRRSANTAN' },
      { 'dark side': 'alignment_dark', scoundrel: 'role_scoundrel' }
    );
    // tiers 1-6 only: 4 stat tiers + tier-3 primary + tier-6 primary
    const expected = 4 * TIER_WEIGHTS.stat + TIER_WEIGHTS.primary3 + TIER_WEIGHTS.primary6;
    expect(scoreCronOnSquad(c, s, r)).toBe(expected);
  });

  it('skips tiers with hasData=false', () => {
    const c = cron({
      tiers: [
        tier(1, { hasData: false }),
        ...Array.from({ length: 8 }, (_, i) => tier(i + 2)),
      ],
    });
    const s = squad(['REY']);
    const r = fakeResolver({}, {});
    // 5 stat tiers (skipped tier 1)
    expect(scoreCronOnSquad(c, s, r)).toBe(5 * TIER_WEIGHTS.stat);
  });

  it('uses cumulative stat magnitude as a tie-breaker between otherwise-equal crons', () => {
    // Same primaries on both crons; only the rolled stat magnitudes differ.
    // Higher-rolled cron wins by a small margin proportional to the gap.
    const sharedTiers = [
      tier(1), tier(2),
      tier(3, { targetRuleId: 'target_datacron_darkside', scopeTargetName: 'Dark Side' }),
      tier(4), tier(5),
      tier(6, { targetRuleId: 'target_datacron_scoundrel', scopeTargetName: 'Scoundrel' }),
      tier(7), tier(8),
      tier(9, { targetRuleId: 'target_datacron_krrsantan', scopeTargetName: 'Krrsantan' }),
    ];
    const highRolled = cron({
      id: 'high', tiers: sharedTiers,
      accumulatedStats: [
        { name: 'Crit Dam',  displayValue: '+50.00%', value: 50 },
        { name: 'Armor Pen', displayValue: '+30.00%', value: 30 },
      ],
    });
    const lowRolled = cron({
      id: 'low', tiers: sharedTiers,
      accumulatedStats: [
        { name: 'Crit Dam',  displayValue: '+25.00%', value: 25 },
        { name: 'Armor Pen', displayValue: '+15.00%', value: 15 },
      ],
    });
    const s = squad(['KRRSANTAN'], 'KRRSANTAN', { KRRSANTAN: ['alignment_dark', 'role_scoundrel'] });
    const r = fakeResolver(
      { krrsantan: 'KRRSANTAN' },
      { 'dark side': 'alignment_dark', scoundrel: 'role_scoundrel' }
    );
    const high = scoreCronOnSquad(highRolled, s, r);
    const low = scoreCronOnSquad(lowRolled, s, r);
    expect(high).toBeGreaterThan(low);
    // Margin reflects the magnitude gap (80 vs 40 = 40 magnitude points).
    expect(high - low).toBeCloseTo(40 * STAT_MAGNITUDE_SCALE, 5);
  });

  it('caps the magnitude bonus so it can never override a primary-tier match', () => {
    // A wildly inflated stat list still contributes only MAX_STAT_MAGNITUDE_BONUS.
    const c = cron({
      accumulatedStats: [
        { name: 'Crit Dam', displayValue: '+9999.00%', value: 9999 },
      ],
    });
    const s = squad(['REY']);
    const r = fakeResolver({}, {});
    // 6 stat tiers (no primaries match) + capped magnitude bonus.
    expect(scoreCronOnSquad(c, s, r)).toBe(6 * TIER_WEIGHTS.stat + MAX_STAT_MAGNITUDE_BONUS);
  });
});
