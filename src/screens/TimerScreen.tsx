import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { usePomodoro } from '../hooks/usePomodoro';
import { loadSettings, loadChallenges } from '../storage/storage';
import { Settings, SessionType, DEFAULT_SETTINGS, Challenge } from '../types';

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

function pickChallenge(challenges: Challenge[], lastGroup?: string): Challenge | null {
  if (challenges.length === 0) return null;

  const groups = [...new Set(challenges.map((c) => c.group))];
  if (groups.length <= 1 || !lastGroup) {
    return challenges[Math.floor(Math.random() * challenges.length)];
  }

  const different = challenges.filter((c) => c.group !== lastGroup);
  const same = challenges.filter((c) => c.group === lastGroup);
  const useDifferent = Math.random() < 0.75 && different.length > 0;
  const pool = useDifferent ? different : same;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function TimerScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [currentChallenge, setCurrentChallenge] = useState<Challenge | null>(null);
  const [challengeModalVisible, setChallengeModalVisible] = useState(false);
  const lastGroupRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadSettings().then(setSettings);
    loadChallenges().then(setChallenges);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadSettings().then(setSettings);
      loadChallenges().then(setChallenges);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleBreakStart = useCallback(() => {
    loadChallenges().then((c) => {
      const challenge = pickChallenge(c, lastGroupRef.current);
      if (challenge) {
        setCurrentChallenge(challenge);
        lastGroupRef.current = challenge.group;
        setChallengeModalVisible(true);
      }
    });
  }, []);

  const { sessionType, timeRemaining, isRunning, completedPomodoros, sessionDurationSeconds, start, pause, reset, skip, seekTo, scrubTo } =
    usePomodoro({ settings, onBreakStart: handleBreakStart });

  useEffect(() => {
    if (sessionType === 'work') setChallengeModalVisible(false);
  }, [sessionType]);

  const handleSkipChallenge = () => {
    const next = pickChallenge(challenges, currentChallenge?.group);
    if (next) {
      setCurrentChallenge(next);
      lastGroupRef.current = next.group;
    }
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

      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={sessionDurationSeconds}
        value={sessionDurationSeconds - timeRemaining + 1}
        onValueChange={(v) => scrubTo(sessionDurationSeconds - v + 1)}
        onSlidingComplete={(v) => seekTo(sessionDurationSeconds - v + 1)}
        minimumTrackTintColor="rgba(255,255,255,0.9)"
        maximumTrackTintColor="rgba(255,255,255,0.3)"
        thumbTintColor="#fff"
      />

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

      <Modal visible={challengeModalVisible} animationType="fade" statusBarTranslucent>
        <SafeAreaView style={[styles.challengeScreen, { backgroundColor: color }]}>
          <View style={styles.challengeTop}>
            <Text style={styles.challengeEyebrow}>Break Challenge</Text>
            {currentChallenge?.group ? (
              <Text style={styles.challengeGroup}>{currentChallenge.group}</Text>
            ) : null}
          </View>
          <Text style={styles.challengeHero}>{currentChallenge?.text}</Text>
          <View style={styles.challengeActions}>
            <TouchableOpacity
              style={styles.challengeDoneBtn}
              onPress={() => setChallengeModalVisible(false)}
            >
              <Text style={styles.challengeDoneBtnText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.challengeSkipBtn}
              onPress={handleSkipChallenge}
            >
              <Text style={styles.challengeSkipBtnText}>Try a different one</Text>
            </TouchableOpacity>
            <Text style={styles.challengeTimer}>{formatTime(timeRemaining)}</Text>
          </View>
        </SafeAreaView>
      </Modal>
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
  slider: {
    width: '100%',
    marginBottom: 24,
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
  // Challenge full-screen modal
  challengeScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingTop: 100,
    paddingBottom: 120,
  },
  challengeTop: {
    alignItems: 'center',
    gap: 8,
  },
  challengeEyebrow: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  challengeGroup: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  challengeHero: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 64,
    flex: 1,
    textAlignVertical: 'center',
  },
  challengeActions: {
    width: '100%',
    gap: 16,
    alignItems: 'center',
  },
  challengeDoneBtn: {
    backgroundColor: '#fff',
    borderRadius: 50,
    paddingVertical: 20,
    width: '100%',
    alignItems: 'center',
  },
  challengeDoneBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  challengeSkipBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  challengeSkipBtnText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontWeight: '600',
  },
  challengeTimer: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
});
