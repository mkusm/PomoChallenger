import { Challenge } from '../types';

export interface PickChallengeCtx {
  breakType: 'shortBreak' | 'longBreak';
  usedToday: Record<string, string>;
  today: string;
  diverseGroups: boolean;
  lastGroup?: string;
  recentIds: string[];
  /** Injectable RNG for deterministic testing; defaults to Math.random. */
  random?: () => number;
}

/**
 * Choose the next break challenge, honouring tag filters, recent-history exclusion,
 * and (optionally) a bias toward a different group than the last one shown.
 * Returns null only when no challenge is eligible at all.
 */
export function pickChallenge(challenges: Challenge[], ctx: PickChallengeCtx): Challenge | null {
  const random = ctx.random ?? Math.random;
  if (challenges.length === 0) return null;

  let eligible = challenges.filter((c) => {
    const tags = c.tags ?? [];
    if (tags.includes('long-break-only') && ctx.breakType !== 'longBreak') return false;
    if (tags.includes('short-break-only') && ctx.breakType !== 'shortBreak') return false;
    if (tags.includes('once-a-day') && ctx.usedToday[c.id] === ctx.today) return false;
    return true;
  });

  // Exclude recently shown challenges, but fall back to full eligible set if that empties it
  const nonRecent = eligible.filter((c) => !ctx.recentIds.includes(c.id));
  if (nonRecent.length > 0) eligible = nonRecent;

  if (eligible.length === 0) return null;

  if (!ctx.diverseGroups) {
    return eligible[Math.floor(random() * eligible.length)];
  }

  const groups = [...new Set(eligible.map((c) => c.group))];
  if (groups.length <= 1 || !ctx.lastGroup) {
    return eligible[Math.floor(random() * eligible.length)];
  }

  const different = eligible.filter((c) => c.group !== ctx.lastGroup);
  const same = eligible.filter((c) => c.group === ctx.lastGroup);
  const useDifferent = random() < 0.75 && different.length > 0;
  // Never index into an empty pool: fall back to whichever set is non-empty.
  const pool = useDifferent ? different : (same.length > 0 ? same : different);
  return pool[Math.floor(random() * pool.length)];
}
