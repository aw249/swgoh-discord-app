/**
 * Normalise an ally code to a plain 9-digit string.
 * Accepts formats like '123456789', '123-456-789', or '123 456 789'.
 * Throws if the result is not exactly 9 digits.
 */
export function normaliseAllyCode(input: string): string {
  const stripped = input.replace(/[-\s]/g, '');
  if (!/^\d{9}$/.test(stripped)) {
    throw new Error('Invalid ally code format. Expected 9 digits (e.g., 123456789 or 123-456-789).');
  }
  return stripped;
}
