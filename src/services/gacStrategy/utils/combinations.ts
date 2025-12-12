export function generateCombinations<T>(
  items: T[],
  size: number,
  maxCombinations: number
): T[][] {
  if (size <= 0 || items.length < size) return [];
  if (size === 1) return items.map(item => [item]);
  
  const result: T[][] = [];
  function combine(start: number, current: T[]): void {
    if (result.length >= maxCombinations) return;
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      if (result.length >= maxCombinations) break;
      current.push(items[i]);
      combine(i + 1, current);
      current.pop();
    }
  }
  combine(0, []);
  return result;
}
