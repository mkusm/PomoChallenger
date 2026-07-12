import { pickChallenge, PickChallengeCtx } from './pickChallenge';
import { Challenge } from '../types';

const c = (id: string, group: string, tags?: Challenge['tags']): Challenge => ({
  id,
  text: `challenge ${id}`,
  group,
  ...(tags ? { tags } : {}),
});

const baseCtx = (over: Partial<PickChallengeCtx> = {}): PickChallengeCtx => ({
  breakType: 'shortBreak',
  usedToday: {},
  today: '2026-07-12',
  diverseGroups: false,
  recentIds: [],
  random: () => 0, // deterministic: always picks index 0 / the "different" branch
  ...over,
});

describe('pickChallenge', () => {
  it('returns null when there are no challenges', () => {
    expect(pickChallenge([], baseCtx())).toBeNull();
  });

  it('picks from the eligible set', () => {
    const list = [c('1', 'A'), c('2', 'A')];
    expect(pickChallenge(list, baseCtx())).toEqual(list[0]);
  });

  it('excludes long-break-only challenges on short breaks', () => {
    const list = [c('1', 'A', ['long-break-only']), c('2', 'A')];
    expect(pickChallenge(list, baseCtx({ breakType: 'shortBreak' }))?.id).toBe('2');
  });

  it('excludes short-break-only challenges on long breaks', () => {
    const list = [c('1', 'A', ['short-break-only']), c('2', 'A')];
    expect(pickChallenge(list, baseCtx({ breakType: 'longBreak' }))?.id).toBe('2');
  });

  it('excludes once-a-day challenges already used today', () => {
    const list = [c('1', 'A', ['once-a-day']), c('2', 'A')];
    const ctx = baseCtx({ usedToday: { '1': '2026-07-12' }, today: '2026-07-12' });
    expect(pickChallenge(list, ctx)?.id).toBe('2');
  });

  it('allows a once-a-day challenge used on a previous day', () => {
    const list = [c('1', 'A', ['once-a-day'])];
    const ctx = baseCtx({ usedToday: { '1': '2026-07-11' }, today: '2026-07-12' });
    expect(pickChallenge(list, ctx)?.id).toBe('1');
  });

  it('avoids recently shown challenges when alternatives exist', () => {
    const list = [c('1', 'A'), c('2', 'A')];
    expect(pickChallenge(list, baseCtx({ recentIds: ['1'] }))?.id).toBe('2');
  });

  it('falls back to recent challenges when they are the only ones eligible', () => {
    const list = [c('1', 'A')];
    expect(pickChallenge(list, baseCtx({ recentIds: ['1'] }))?.id).toBe('1');
  });

  // Regression for the empty-pool bug: diverseGroups on, every eligible challenge is in a
  // group different from lastGroup, and the RNG lands on the "use same group" branch.
  it('never returns undefined when the same-group pool is empty (diverse mode)', () => {
    const list = [c('1', 'B'), c('2', 'B')];
    const ctx = baseCtx({
      diverseGroups: true,
      lastGroup: 'A', // no challenge is in group A
      random: () => 0.9, // >= 0.75 → would have chosen the empty "same" pool
    });
    const result = pickChallenge(list, ctx);
    expect(result).not.toBeUndefined();
    expect(result).not.toBeNull();
    expect(['1', '2']).toContain(result?.id);
  });

  it('biases toward a different group when RNG is below the threshold', () => {
    const list = [c('1', 'A'), c('2', 'B')];
    const ctx = baseCtx({
      diverseGroups: true,
      lastGroup: 'A',
      random: () => 0, // < 0.75 → prefer a different group than A
    });
    expect(pickChallenge(list, ctx)?.group).toBe('B');
  });
});
