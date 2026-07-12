import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { usePomodoro } from '../hooks/usePomodoro';
import { loadSettings, loadChallenges, loadLastGroup, saveLastGroup, loadChallengeDates, saveChallengeDates, loadRecentChallengeIds, saveRecentChallengeIds } from '../storage/storage';
import { Settings, SessionType, DEFAULT_SETTINGS, Challenge, TAG_LABELS } from '../types';
import { pickChallenge } from '../logic/pickChallenge';

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

const RECENT_LIMIT = 3;

export default function TimerScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [currentChallenge, setCurrentChallenge] = useState<Challenge | null>(null);
  const [challengeModalVisible, setChallengeModalVisible] = useState(false);
  const lastGroupRef = useRef<string | undefined>(undefined);
  const challengeDatesRef = useRef<Record<string, string>>({});
  const recentIdsRef = useRef<string[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const settingsJsonRef = useRef('');
  const challengesJsonRef = useRef('');

  const refreshData = useCallback(() => {
    Promise.all([loadSettings(), loadChallenges()]).then(([s, c]) => {
      const sJson = JSON.stringify(s);
      const cJson = JSON.stringify(c);
      if (sJson !== settingsJsonRef.current) { settingsJsonRef.current = sJson; setSettings(s); }
      if (cJson !== challengesJsonRef.current) { challengesJsonRef.current = cJson; setChallenges(c); }
    });
  }, []);

  const refreshHistoryRefs = useCallback(() => {
    Promise.all([loadLastGroup(), loadChallengeDates(), loadRecentChallengeIds()])
      .then(([g, d, ids]) => {
        lastGroupRef.current = g;
        challengeDatesRef.current = d;
        recentIdsRef.current = ids;
      });
  }, []);

  // Reload settings/challenges when the Timer tab regains focus, instead of polling every
  // second. Settings and challenge history only change from the other tabs, so focus is the
  // right trigger; the JSON guard in refreshData avoids resetting live timer state.
  useFocusEffect(
    useCallback(() => {
      refreshData();
      refreshHistoryRefs();
    }, [refreshData, refreshHistoryRefs])
  );

  const recordChallengeShown = useCallback((id: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const recentIds = [id, ...recentIdsRef.current.filter((r) => r !== id)].slice(0, RECENT_LIMIT);
    const dates = { ...challengeDatesRef.current, [id]: today };
    recentIdsRef.current = recentIds;
    challengeDatesRef.current = dates;
    saveRecentChallengeIds(recentIds);
    saveChallengeDates(dates);
  }, []);

  const handleBreakStart = useCallback((breakType: SessionType) => {
    const today = new Date().toISOString().slice(0, 10);
    loadChallenges().then((c) => {
      const challenge = pickChallenge(c, {
        breakType: breakType as 'shortBreak' | 'longBreak',
        usedToday: challengeDatesRef.current,
        today,
        diverseGroups: settingsRef.current.diverseGroups,
        lastGroup: lastGroupRef.current,
        recentIds: recentIdsRef.current,
      });
      if (challenge) {
        setCurrentChallenge(challenge);
        lastGroupRef.current = challenge.group;
        saveLastGroup(challenge.group);
        recordChallengeShown(challenge.id);
        setChallengeModalVisible(true);
      }
    });
  }, [recordChallengeShown]);

  const { sessionType, timeRemaining, isRunning, completedPomodoros, sessionDurationSeconds, start, pause, reset, skip, seekTo, scrubTo } =
    usePomodoro({ settings, onBreakStart: handleBreakStart });

  useEffect(() => {
    if (sessionType === 'work') setChallengeModalVisible(false);
  }, [sessionType]);

  const handleSkipChallenge = () => {
    const today = new Date().toISOString().slice(0, 10);
    const next = pickChallenge(challenges, {
      breakType: sessionType as 'shortBreak' | 'longBreak',
      usedToday: challengeDatesRef.current,
      today,
      diverseGroups: settingsRef.current.diverseGroups,
      lastGroup: currentChallenge?.group,
      recentIds: recentIdsRef.current,
    });
    if (next) {
      setCurrentChallenge(next);
      if (next.group !== lastGroupRef.current) saveLastGroup(next.group);
      lastGroupRef.current = next.group;
      recordChallengeShown(next.id);
    }
  };

  const color = SESSION_COLORS[sessionType];
  // The slider runs forward (elapsed) while the timer counts down, so value and remaining
  // are mirror images around the session duration.
  const sliderToRemaining = (v: number) => sessionDurationSeconds - v + 1;
  const sliderValue = sessionDurationSeconds - timeRemaining + 1;

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
        value={sliderValue}
        onValueChange={(v) => scrubTo(sliderToRemaining(v))}
        onSlidingComplete={(v) => seekTo(sliderToRemaining(v))}
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
            {(currentChallenge?.tags ?? []).length > 0 && (
              <View style={styles.challengeTagRow}>
                {(currentChallenge?.tags ?? []).map((tag) => (
                  <View key={tag} style={[styles.challengeTagPill, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                    <Text style={styles.challengeTagText}>{TAG_LABELS[tag]}</Text>
                  </View>
                ))}
              </View>
            )}
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
  challengeTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 4,
  },
  challengeTagPill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  challengeTagText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
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
