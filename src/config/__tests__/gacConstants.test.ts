import { normaliseLeague } from '../gacConstants';

describe('normaliseLeague', () => {
  it('should capitalise first letter and lowercase the rest', () => {
    expect(normaliseLeague('KYBER')).toBe('Kyber');
    expect(normaliseLeague('kyber')).toBe('Kyber');
    expect(normaliseLeague('Kyber')).toBe('Kyber');
    expect(normaliseLeague('AURODIUM')).toBe('Aurodium');
    expect(normaliseLeague('chromium')).toBe('Chromium');
  });

  it('should handle single character strings', () => {
    expect(normaliseLeague('k')).toBe('K');
    expect(normaliseLeague('K')).toBe('K');
  });

  it('should handle empty string', () => {
    expect(normaliseLeague('')).toBe('');
  });
});
