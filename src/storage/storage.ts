import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings, DEFAULT_SETTINGS, DEFAULT_CHALLENGES } from '../types';

const KEYS = {
  SETTINGS: 'pomo_settings',
  CHALLENGES: 'pomo_challenges',
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

export async function loadChallenges(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHALLENGES);
    if (!raw) return DEFAULT_CHALLENGES;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CHALLENGES;
  }
}

export async function saveChallenges(challenges: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.CHALLENGES, JSON.stringify(challenges));
}
