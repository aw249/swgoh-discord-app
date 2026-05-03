import * as fs from 'fs';
import * as path from 'path';

/**
 * Smoke test for the JSON-attribute capture pattern used in the scraper.
 *
 * The scraper itself runs inside Puppeteer's page.evaluate(); we can't drive
 * its full DOM logic from a node test. What we CAN verify is the brittle bit
 * — the attribute name + selector + JSON parse — against a real fixture
 * captured from a live swgoh.gg page.
 *
 * If this test fails after a swgoh.gg HTML change, the scraper's selector
 * needs updating in the same place.
 */
describe('GAC defense squad cron capture (selector + parse)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, 'fixtures/gacBattleSummary.html'),
    'utf8'
  );

  function extractFirstCronJson(blockHtml: string): unknown | null {
    const m = blockHtml.match(
      /<div class="datacron-icon"\s+data-player-datacron-tooltip-app=(['"])([\s\S]*?)\1/
    );
    if (!m) return null;
    try {
      return JSON.parse(m[2]);
    } catch {
      return null;
    }
  }

  function getDefenseBlocks(): string[] {
    const blocks: string[] = [];
    const re = /<div class="gac-counters-battle-summary__side gac-counters-battle-summary__side--defense">([\s\S]*?)(?=<div class="gac-counters-battle-summary__side|<\/div>\s*<\/body>)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      blocks.push(match[1]);
    }
    return blocks;
  }

  it('extracts the cron JSON when present', () => {
    const blocks = getDefenseBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const cron = extractFirstCronJson(blocks[0]) as { id: string; derived: { name: string } } | null;
    expect(cron).not.toBeNull();
    expect(cron!.id).toBe('AORkllTcR_argyeY0lWbUw');
    expect(cron!.derived.name).toBe('Power for Hire');
  });

  it('returns null when the squad has no datacron-icon element', () => {
    const blocks = getDefenseBlocks();
    expect(extractFirstCronJson(blocks[1])).toBeNull();
  });
});
