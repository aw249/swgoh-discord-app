import sampleScraped from '../fixtures/sampleCronTooltip.json';
import sampleComlink from '../fixtures/sampleComlinkDatacron.json';
import { fromComlink, fromScraped } from '../../datacronAllocator/normalize';
import { ComlinkDatacron } from '../../../integrations/comlink/comlinkClient';

describe('normalize.fromScraped', () => {
  it('preserves id, setId, focused, currentTier, name', () => {
    const c = fromScraped(sampleScraped as never);
    expect(c.id).toBe('AORkllTcR_argyeY0lWbUw');
    expect(c.setId).toBe(28);
    expect(c.focused).toBe(false);
    expect(c.currentTier).toBe(9);
    expect(c.name).toBe('Power for Hire');
    expect(c.source).toBe('scraped');
  });

  it('extracts CDN URLs verbatim', () => {
    const c = fromScraped(sampleScraped as never);
    expect(c.boxImageUrl).toBe('https://game-assets.swgoh.gg/textures/tex.datacron_d_max.png');
    expect(c.calloutImageUrl).toBe('https://game-assets.swgoh.gg/textures/tex.charui_krrsantan.png');
  });

  it('produces 9 tiers with correct scopeTargetName, targetRuleId, abilityId', () => {
    const c = fromScraped(sampleScraped as never);
    expect(c.tiers).toHaveLength(9);
    expect(c.tiers[2]).toMatchObject({
      index: 3,
      targetRuleId: 'target_datacron_darkside',
      abilityId: 'datacron_alignment_generic_018',
      scopeTargetName: 'Dark Side',
      hasData: true,
    });
    expect(c.tiers[8]).toMatchObject({
      index: 9,
      targetRuleId: 'target_datacron_krrsantan',
      scopeTargetName: 'Krrsantan',
      hasData: true,
    });
  });

  it('marks tiers without derived.has_data as hasData=false', () => {
    const partial = JSON.parse(JSON.stringify(sampleScraped));
    partial.derived.tiers[5].derived.has_data = false;
    const c = fromScraped(partial);
    expect(c.tiers[5].hasData).toBe(false);
  });
});

describe('normalize.fromComlink', () => {
  it('produces a DatacronCandidate with source=comlink', () => {
    const c = fromComlink(sampleComlink as unknown as ComlinkDatacron);
    expect(c.source).toBe('comlink');
    expect(c.id).toBe('SRgZut27RnCQrbk5yLKZug');
    expect(c.setId).toBe(27);
    expect(c.focused).toBe(true);
  });

  it('derives currentTier from rerollIndex+1 for unfocused; 9 for focused', () => {
    const focused = fromComlink({ ...sampleComlink, focused: true } as unknown as ComlinkDatacron);
    expect(focused.currentTier).toBe(9);
    const unfocused = fromComlink({ ...sampleComlink, focused: false, rerollIndex: 5 } as unknown as ComlinkDatacron);
    // unfocused tier cap is 6
    expect(unfocused.currentTier).toBe(6);
  });

  it('maps affix entries to the same tier shape', () => {
    const c = fromComlink(sampleComlink as unknown as ComlinkDatacron);
    expect(c.tiers).toHaveLength(9);
    // tier 3 (index 2) on Maul Hate-Fueled is the darkside affix
    expect(c.tiers[2]).toMatchObject({
      index: 3,
      targetRuleId: 'target_datacron_darkside',
      hasData: true,
    });
    // scope target name is derived heuristically from targetRule (since Comlink doesn't provide a localised string)
    expect(c.tiers[2].scopeTargetName.length).toBeGreaterThan(0);
  });

  it('builds CDN URLs for Comlink crons using set icon pattern', () => {
    const c = fromComlink(sampleComlink as unknown as ComlinkDatacron);
    // Comlink set 27 → datacron_c style; full URL pattern uses _max suffix at tier 9.
    expect(c.boxImageUrl).toMatch(/^https:\/\/game-assets\.swgoh\.gg\/textures\/tex\.datacron_[abcd](_max)?\.png$/);
    expect(c.calloutImageUrl).toMatch(/^https:\/\/game-assets\.swgoh\.gg\/textures\/tex\.charui_/);
  });
});
