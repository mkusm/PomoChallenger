import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePomodoro } from '../hooks/usePomodoro';
import { loadSettings, loadChallenges } from '../storage/storage';
import { Settings, SessionType, DEFAULT_SETTINGS } from '../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SESSION_COLORS: Record<SessionType, string> = {
  work: '#E53935',
  shortBreak: '#43A047',
  longBreak: '#1E88E5',
};

const SESSION_LABELS: Record<SessionType, string> = {
  work: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break',
};

function pickRandom(arr: string[], exclude?: string): string {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  const filtered = exclude ? arr.filter((c) => c !== exclude) : arr;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export default function TimerScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [challenges, setChallenges] = useState<string[]>([]);
  const [currentChallenge, setCurrentChallenge] = useState<string>('');
  const [showChallenge, setShowChallenge] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    loadChallenges().then(setChallenges);
  }, []);

  // Reload settings/challenges when screen gains focus (user may have edited them)
  useEffect(() => {
    const interval = setInterval(() => {
      loadSettings().then(setSettings);
      loadChallenges().then(setChallenges);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleBreakStart = useCallback(() => {
    loadChallenges().then((c) => {
      const challenge = pickRandom(c);
      setCurrentChallenge(challenge);
      setShowChallenge(challenge.length > 0);
    });
  }, []);

  const { sessionType, timeRemaining, isRunning, completedPomodoros, start, pause, reset, skip } =
    usePomodoro({ settings, onBreakStart: handleBreakStart });

  // Hide challenge once work session starts
  useEffect(() => {
    if (sessionType === 'work') setShowChallenge(false);
  }, [sessionType]);

  const handleSkipChallenge = () => {
    const next = pickRandom(challenges, currentChallenge);
    setCurrentChallenge(next);
  };

  const color = SESSION_COLORS[sessionType];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: color }]}>
      <Text style={styles.sessionLabel}>{SESSION_LABELS[sessionType]}</Text>

      <Text style={styles.timer}>{formatTime(timeRemaining)}</Text>

      <View style={styles.pomodoroRow}>
        {[...Array(4)].map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < completedPomodoros % 4 ? '#fff' : 'rgba(255,255,255,0.3)' },
            ]}
          />
        ))}
      </View>

      {showChallenge && currentChallenge ? (
        <View style={styles.challengeCard}>
          <Text style={styles.challengeTitle}>Break Challenge</Text>
          <Text style={styles.challengeText}>{currentChallenge}</Text>
          <TouchableOpacity onPress={handleSkipChallenge} style={styles.skipBtn}>
            <Text style={styles.skipBtnText}>Try a different one</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.controls}>
        {!isRunning ? (
          <TouchableOpacity style={styles.btnPrimary} onPress={start}>
            <Text style={styles.btnPrimaryText}>Start</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnPrimary} onPress={pause}>
            <Text style={styles.btnPrimaryText}>Pause</Text>
          </TouchableOpacity>
        )}
        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.btnSecondary} onPress={reset}>
            <Text style={styles.btnSecondaryText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={skip}>
            <Text style={styles.btnSecondaryText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sessionLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  timer: {
    color: '#fff',
    fontSize: 88,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  pomodoroRow: {
    flexDirection: 'row',
    marginTop: 20,
    marginBottom: 32,
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  challengeCard: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  challengeTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  challengeText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  skipBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  skipBtnText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  controls: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: '#fff',
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 60,
  },
  btnPrimaryText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 16,
  },
  btnSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  btnSecondaryText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
});
