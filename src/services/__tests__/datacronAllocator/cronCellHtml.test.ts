import { renderCronCell, renderEmptyCronCell } from '../../datacronAllocator/cronCellHtml';
import { AssignedCron, DatacronCandidate, DatacronTier } from '../../datacronAllocator/types';

function tier(i: number, has = true): DatacronTier {
  return { index: i, targetRuleId: '', abilityId: '', scopeTargetName: '', hasData: has };
}

const sampleCron: DatacronCandidate = {
  source: 'scraped', id: 'cron-1', setId: 28, focused: true, currentTier: 9,
  name: 'Power for Hire',
  tiers: Array.from({ length: 9 }, (_, i) => tier(i + 1)),
  boxImageUrl: 'https://example/cron.png',
  calloutImageUrl: 'https://example/callout.png',
  accumulatedStats: [],
};

describe('renderCronCell', () => {
  it('renders the cron name, box image, callout image', () => {
    const html = renderCronCell({ candidate: sampleCron, score: 30, filler: false }, 'friendly');
    expect(html).toContain('Power for Hire');
    expect(html).toContain('https://example/cron.png');
    expect(html).toContain('https://example/callout.png');
  });

  it('marks filler crons with a "(filler)" annotation', () => {
    const filler: AssignedCron = { candidate: sampleCron, score: 6, filler: true };
    const html = renderCronCell(filler, 'friendly');
    expect(html.toLowerCase()).toContain('filler');
  });

  it('uses the friendly border class for friendly side', () => {
    const html = renderCronCell({ candidate: sampleCron, score: 30, filler: false }, 'friendly');
    expect(html).toMatch(/cron-cell--friendly/);
  });

  it('uses the opponent border class for opponent side', () => {
    const html = renderCronCell({ candidate: sampleCron, score: 30, filler: false }, 'opponent');
    expect(html).toMatch(/cron-cell--opponent/);
  });

  it('shows three primary-tier dots, lit per current tier', () => {
    const html = renderCronCell({ candidate: sampleCron, score: 30, filler: false }, 'friendly');
    // 3 dots for tiers 3/6/9
    expect((html.match(/cron-cell__dot/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // tier 9 cron has all 3 lit
    expect((html.match(/cron-cell__dot--lit/g) ?? []).length).toBe(3);
  });

  it('lits only the dots for tiers reached by the current tier', () => {
    const lower: DatacronCandidate = { ...sampleCron, focused: false, currentTier: 6 };
    const html = renderCronCell({ candidate: lower, score: 16, filler: false }, 'friendly');
    expect((html.match(/cron-cell__dot--lit/g) ?? []).length).toBe(2);
  });

  it('escapes HTML in the cron name', () => {
    const evil: DatacronCandidate = { ...sampleCron, name: '<script>alert(1)</script>' };
    const html = renderCronCell({ candidate: evil, score: 10, filler: false }, 'friendly');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the accumulated stats list when stats are present', () => {
    const withStats: DatacronCandidate = {
      ...sampleCron,
      accumulatedStats: [
        { name: 'Critical Damage', displayValue: '+25.00%', value: 25 },
        { name: 'Potency', displayValue: '+50.00%', value: 50 },
      ],
    };
    const html = renderCronCell({ candidate: withStats, score: 30, filler: false }, 'friendly');
    expect(html).toContain('cron-cell__stats');
    expect(html).toContain('Critical Damage');
    expect(html).toContain('+25.00%');
    expect(html).toContain('Potency');
    expect(html).toContain('+50.00%');
  });

  it('omits the stats block when there are no accumulated stats', () => {
    const html = renderCronCell({ candidate: sampleCron, score: 30, filler: false }, 'friendly');
    expect(html).not.toContain('cron-cell__stats');
  });

  it('renders primary-tier targets up to current tier', () => {
    const withTiers: DatacronCandidate = {
      ...sampleCron,
      currentTier: 9,
      tiers: [
        tier(1), tier(2),
        { index: 3, targetRuleId: 'target_datacron_darkside', abilityId: '', scopeTargetName: 'Dark Side', hasData: true },
        tier(4), tier(5),
        { index: 6, targetRuleId: 'target_datacron_scoundrel', abilityId: '', scopeTargetName: 'Scoundrel', hasData: true },
        tier(7), tier(8),
        { index: 9, targetRuleId: 'target_datacron_krrsantan', abilityId: '', scopeTargetName: 'Krrsantan', hasData: true },
      ],
    };
    const html = renderCronCell({ candidate: withTiers, score: 50, filler: false }, 'friendly');
    expect(html).toContain('cron-cell__tiers');
    expect(html).toContain('T3');
    expect(html).toContain('Dark Side');
    expect(html).toContain('T6');
    expect(html).toContain('Scoundrel');
    expect(html).toContain('T9');
    expect(html).toContain('Krrsantan');
  });

  it('omits primary tiers above the cron currentTier', () => {
    const partial: DatacronCandidate = {
      ...sampleCron,
      currentTier: 6,
      focused: false,
      tiers: [
        tier(1), tier(2),
        { index: 3, targetRuleId: 'target_datacron_darkside', abilityId: '', scopeTargetName: 'Dark Side', hasData: true },
        tier(4), tier(5),
        { index: 6, targetRuleId: 'target_datacron_scoundrel', abilityId: '', scopeTargetName: 'Scoundrel', hasData: true },
        tier(7), tier(8),
        { index: 9, targetRuleId: 'target_datacron_krrsantan', abilityId: '', scopeTargetName: 'Krrsantan', hasData: true },
      ],
    };
    const html = renderCronCell({ candidate: partial, score: 16, filler: false }, 'friendly');
    expect(html).toContain('Dark Side');
    expect(html).toContain('Scoundrel');
    expect(html).not.toContain('Krrsantan');
  });
});

describe('renderEmptyCronCell', () => {
  it('renders a hidden cell that preserves layout width without showing a placeholder', () => {
    const html = renderEmptyCronCell();
    expect(html).toContain('cron-cell--empty');
    // No placeholder text or "No cron" badge — the cell is purely a spacer.
    expect(html.toLowerCase()).not.toContain('no cron');
    expect(html.toLowerCase()).not.toContain('placeholder');
  });
});
