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
});

describe('renderEmptyCronCell', () => {
  it('renders a placeholder div with consistent dimensions', () => {
    const html = renderEmptyCronCell();
    expect(html).toContain('cron-cell--empty');
    expect(html.toLowerCase()).toContain('no cron');
  });
});
