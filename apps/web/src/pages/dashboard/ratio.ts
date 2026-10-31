/** part / total, or null when there is nothing to divide by (renders as "—"). */
export function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null
}
