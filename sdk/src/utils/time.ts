/**
 * Time utilities for HTLC timelock calculations
 */

/**
 * Calculate timelock timestamp for HTLC based on duration
 * @param durationSeconds - Duration in seconds from now
 * @returns Unix timestamp for the timelock
 */
export function calculateTimelock(durationSeconds: number): number {
  return Math.floor(Date.now() / 1000) + durationSeconds;
}

/**
 * Calculate timelock with safety buffer
 * @param baseDurationSeconds - Base duration in seconds
 * @param bufferSeconds - Safety buffer in seconds
 * @returns Unix timestamp for the timelock
 */
export function calculateTimelockWithBuffer(
  baseDurationSeconds: number,
  bufferSeconds: number = 3600 // 1 hour default buffer
): number {
  return calculateTimelock(baseDurationSeconds + bufferSeconds);
}

/**
 * Get the remaining time until a timelock expires
 * @param timelock - Unix timestamp of the timelock
 * @returns Remaining seconds (negative if expired)
 */
export function getTimelockRemaining(timelock: number): number {
  return timelock - Math.floor(Date.now() / 1000);
}

/**
 * Check if a timelock has expired
 * @param timelock - Unix timestamp of the timelock
 * @returns True if expired
 */
export function isTimelockExpired(timelock: number): boolean {
  return getTimelockRemaining(timelock) <= 0;
}

/**
 * Format remaining time as human readable string
 * @param seconds - Remaining seconds
 * @returns Formatted string (e.g., "2h 30m", "5m 20s", "expired")
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) {
    return 'expired';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Common timelock durations in seconds
 */
export const TIMELOCK_DURATIONS = {
  FIVE_MINUTES: 5 * 60,
  TEN_MINUTES: 10 * 60,
  THIRTY_MINUTES: 30 * 60,
  ONE_HOUR: 60 * 60,
  TWO_HOURS: 2 * 60 * 60,
  SIX_HOURS: 6 * 60 * 60,
  TWELVE_HOURS: 12 * 60 * 60,
  TWENTY_FOUR_HOURS: 24 * 60 * 60,
  FORTY_EIGHT_HOURS: 48 * 60 * 60,
} as const;

/**
 * Calculate stepped timelocks for multi-hop swaps
 * Each hop should have a shorter timelock than the previous
 * @param baseDuration - Base duration for the first hop
 * @param hops - Number of hops
 * @param stepReduction - Reduction per hop in seconds
 * @returns Array of timelock timestamps
 */
export function calculateSteppedTimelocks(
  baseDuration: number,
  hops: number,
  stepReduction: number = 3600 // 1 hour reduction per hop
): number[] {
  const timelocks: number[] = [];

  for (let i = 0; i < hops; i++) {
    const duration = baseDuration - (i * stepReduction);
    if (duration <= 0) {
      throw new Error('Timelock duration would be negative or zero');
    }
    timelocks.push(calculateTimelock(duration));
  }

  return timelocks;
}

/**
 * Validate that a timelock is reasonable (not too far in past/future)
 * @param timelock - Unix timestamp to validate
 * @param maxFuture - Maximum seconds in future (default 7 days)
 * @param allowPast - Whether to allow past timestamps
 * @returns True if valid
 */
export function isValidTimelock(
  timelock: number,
  maxFuture: number = 7 * 24 * 60 * 60, // 7 days
  allowPast: boolean = false
): boolean {
  const now = Math.floor(Date.now() / 1000);

  if (!allowPast && timelock <= now) {
    return false;
  }

  if (timelock > now + maxFuture) {
    return false;
  }

  return true;
}

/**
 * Convert duration string to seconds
 * Supports formats like "1h", "30m", "45s", "2h30m"
 * @param duration - Duration string
 * @returns Duration in seconds
 */
export function parseDuration(duration: string): number {
  const regex = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
  const match = duration.match(regex);

  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
}
