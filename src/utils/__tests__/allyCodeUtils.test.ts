import { normaliseAllyCode } from '../allyCodeUtils';

describe('normaliseAllyCode', () => {
  it('should return a plain 9-digit code unchanged', () => {
    expect(normaliseAllyCode('123456789')).toBe('123456789');
  });

  it('should strip dashes from ally code', () => {
    expect(normaliseAllyCode('123-456-789')).toBe('123456789');
  });

  it('should strip spaces from ally code', () => {
    expect(normaliseAllyCode('123 456 789')).toBe('123456789');
  });

  it('should throw for codes shorter than 9 digits', () => {
    expect(() => normaliseAllyCode('12345')).toThrow('Invalid ally code');
  });

  it('should throw for codes longer than 9 digits', () => {
    expect(() => normaliseAllyCode('1234567890')).toThrow('Invalid ally code');
  });

  it('should throw for non-numeric input', () => {
    expect(() => normaliseAllyCode('abcdefghi')).toThrow('Invalid ally code');
  });

  it('should throw for empty string', () => {
    expect(() => normaliseAllyCode('')).toThrow('Invalid ally code');
  });
});
