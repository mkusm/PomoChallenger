import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { Settings, SessionType, DEFAULT_SETTINGS, DEFAULT_CHALLENGES, DEFAULT_GROUPS, Challenge } from '../types';

// Emitted after settings/challenges are written so other screens (TimerScreen) can reload
// immediately, instead of racing the in-flight AsyncStorage write on the next tab focus.
export const STORAGE_CHANGED_EVENT = 'pomo_storage_changed';

const KEYS = {
  SETTINGS: 'pomo_settings',
  CHALLENGES: 'pomo_challenges',
  GROUPS: 'pomo_groups',
  LAST_GROUP: 'pomo_last_group',
  CHALLENGE_DATES: 'pomo_challenge_dates',
  RECENT_CHALLENGES: 'pomo_recent_challenges',
  TIMER_STATE: 'pomo_timer_state',
};

// Snapshot of the running timer, persisted so a session survives process death / OEM kills.
// endTime is the absolute wall-clock ms when the session ends (null when not running).
export interface PersistedTimerState {
  endTime: number | null;
  sessionType: SessionType;
  completedPomodoros: number;
  isRunning: boolean;
}

export async function saveTimerState(state: PersistedTimerState): Promise<void> {
  await AsyncStorage.setItem(KEYS.TIMER_STATE, JSON.stringify(state));
}

export async function loadTimerState(): Promise<PersistedTimerState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.TIMER_STATE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null || typeof s.sessionType !== 'string') return null;
    return s as PersistedTimerState;
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  DeviceEventEmitter.emit(STORAGE_CHANGED_EVENT);
}

export async function loadChallenges(): Promise<Challenge[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHALLENGES);
    if (!raw) return DEFAULT_CHALLENGES;
    const parsed = JSON.parse(raw);
    // Migrate from old string[] format
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      const migrated: Challenge[] = (parsed as string[]).map((text, i) => ({
        id: String(Date.now() + i),
        text,
        group: 'General',
      }));
      await saveChallenges(migrated);
      return migrated;
    }
    // Guard against corrupt storage: fall back to defaults if the shape is wrong
    // (an empty array is valid — the user deleted every challenge).
    if (!Array.isArray(parsed)) return DEFAULT_CHALLENGES;
    const valid = parsed.every(
      (c: unknown): c is Challenge =>
        !!c && typeof (c as Challenge).id === 'string' &&
        typeof (c as Challenge).text === 'string' &&
        typeof (c as Challenge).group === 'string'
    );
    return valid ? (parsed as Challenge[]) : DEFAULT_CHALLENGES;
  } catch {
    return DEFAULT_CHALLENGES;
  }
}

export async function saveChallenges(challenges: Challenge[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.CHALLENGES, JSON.stringify(challenges));
  DeviceEventEmitter.emit(STORAGE_CHANGED_EVENT);
}

export async function loadGroups(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.GROUPS);
    if (!raw) return DEFAULT_GROUPS;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_GROUPS;
  }
}

export async function saveGroups(groups: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.GROUPS, JSON.stringify(groups));
}

export async function loadLastGroup(): Promise<string | undefined> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.LAST_GROUP);
    return raw ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveLastGroup(group: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.LAST_GROUP, group);
}

// Maps challenge ID → date string (YYYY-MM-DD) of last use; used for once-a-day filtering.
// Prunes entries from previous days on load so the dict stays small.
export async function loadChallengeDates(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHALLENGE_DATES);
    if (!raw) return {};
    const parsed: Record<string, string> = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    const pruned = Object.fromEntries(Object.entries(parsed).filter(([, d]) => d === today));
    if (Object.keys(pruned).length !== Object.keys(parsed).length) {
      await AsyncStorage.setItem(KEYS.CHALLENGE_DATES, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return {};
  }
}

export async function saveChallengeDates(dates: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(KEYS.CHALLENGE_DATES, JSON.stringify(dates));
}

export async function loadRecentChallengeIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.RECENT_CHALLENGES);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveRecentChallengeIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.RECENT_CHALLENGES, JSON.stringify(ids));
}

export async function clearChallengeHistory(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.LAST_GROUP, KEYS.CHALLENGE_DATES, KEYS.RECENT_CHALLENGES]);
}
