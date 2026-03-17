import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings, DEFAULT_SETTINGS, DEFAULT_CHALLENGES, DEFAULT_GROUPS, Challenge } from '../types';

const KEYS = {
  SETTINGS: 'pomo_settings',
  CHALLENGES: 'pomo_challenges',
  GROUPS: 'pomo_groups',
};

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
    return parsed as Challenge[];
  } catch {
    return DEFAULT_CHALLENGES;
  }
}

export async function saveChallenges(challenges: Challenge[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.CHALLENGES, JSON.stringify(challenges));
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
