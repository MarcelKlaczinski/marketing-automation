/**
 * Formats a EUR value for display.
 * >= 1.00 → 2 decimals; < 1.00 → 4 decimals; < 0.0001 → 6 decimals
 */
export function formatEur(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  if (Math.abs(num) >= 1) return num.toFixed(2);
  if (Math.abs(num) >= 0.0001) return num.toFixed(4);
  return num.toFixed(6);
}
