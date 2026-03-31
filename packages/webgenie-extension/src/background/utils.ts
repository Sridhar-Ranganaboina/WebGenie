/** Lightweight unique-ID generator for background context (no crypto.randomUUID in SW) */
export function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/** Sleep for N milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Clamp a number between min and max */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
