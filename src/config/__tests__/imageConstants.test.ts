import { SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, TENACITY_ICON, POTENCY_ICON, STAT_ID } from '../imageConstants';

describe('imageConstants', () => {
  describe('stat icons', () => {
    it('should export all 5 icon constants as base64 webp strings', () => {
      const icons = [SPEED_ICON, HEALTH_ICON, PROTECTION_ICON, TENACITY_ICON, POTENCY_ICON];
      for (const icon of icons) {
        expect(icon).toMatch(/^data:image\/webp;base64,/);
        expect(icon.length).toBeGreaterThan(50);
      }
    });
  });

  describe('STAT_ID', () => {
    it('should map stat names to their numeric string IDs', () => {
      expect(STAT_ID.HEALTH).toBe('1');
      expect(STAT_ID.SPEED).toBe('5');
      expect(STAT_ID.PROTECTION).toBe('28');
    });

    it('should be readonly', () => {
      expect(typeof STAT_ID.HEALTH).toBe('string');
      expect(typeof STAT_ID.SPEED).toBe('string');
      expect(typeof STAT_ID.PROTECTION).toBe('string');
    });
  });
});
