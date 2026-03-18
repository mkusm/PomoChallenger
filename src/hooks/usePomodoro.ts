import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { SessionType, Settings } from '../types';
import { CHANNEL_WORK, CHANNEL_BREAK } from '../../App';

const soundAssets = {
  work: require('../../assets/ding2.wav'),
  break: require('../../assets/ding.wav'),
};

const soundFiles = { work: 'ding2.wav', break: 'ding.wav' };

// On Android use AlarmSound native module so audio routes through alarm volume stream.
// On iOS (or if module missing) fall back to expo-av.
async function playSound(type: 'work' | 'break', asset: ReturnType<typeof require>) {
  if (Platform.OS === 'android' && NativeModules.AlarmSound) {
    NativeModules.AlarmSound.play(soundFiles[type]);
    return;
  }
  try {
    const { sound } = await Audio.Sound.createAsync(asset);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
    });
  } catch (e) {
    // non-critical
  }
}

interface UsePomodoroOptions {
  settings: Settings;
  onBreakStart: () => void;
}

interface UsePomodoroReturn {
  sessionType: SessionType;
  timeRemaining: number;
  isRunning: boolean;
  completedPomodoros: number;
  sessionDurationSeconds: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  seekTo: (seconds: number) => void;
  scrubTo: (seconds: number) => void;
}

function sessionDuration(type: SessionType, settings: Settings): number {
  switch (type) {
    case 'work':       return settings.workDuration * 60;
    case 'shortBreak': return settings.shortBreakDuration * 60;
    case 'longBreak':  return settings.longBreakDuration * 60;
  }
}

function sessionLabel(type: SessionType): string {
  switch (type) {
    case 'work':      return 'Work session complete! Time for a break.';
    case 'shortBreak':
    case 'longBreak': return 'Break over! Back to work.';
  }
}

async function cancelScheduledNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

async function scheduleEndNotification(title: string, body: string, fireAt: Date, sessionType: SessionType) {
  const channelId = sessionType === 'work' ? CHANNEL_WORK : CHANNEL_BREAK;
  const sound = sessionType === 'work' ? 'ding2.wav' : 'ding.wav';
  await cancelScheduledNotifications();
  if (Platform.OS === 'android' && NativeModules.AlarmSound) {
    // On Android, AlarmService handles the notification — skip expo-notifications to avoid duplicates
    NativeModules.AlarmSound.scheduleAlarm(fireAt.getTime(), title, body, sound);
  } else {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId },
    });
  }
}

function cancelAlarmActivity() {
  if (Platform.OS === 'android' && NativeModules.AlarmSound) {
    NativeModules.AlarmSound.cancelAlarm();
  }
}

export function usePomodoro({ settings, onBreakStart }: UsePomodoroOptions): UsePomodoroReturn {
  const [sessionType, setSessionType] = useState<SessionType>('work');
  const [timeRemaining, setTimeRemaining] = useState<number>(sessionDuration('work', settings));
  const [isRunning, setIsRunning] = useState(false);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);

  // endTime: the absolute timestamp when the current session ends
  const endTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionTypeRef = useRef(sessionType);
  const completedRef = useRef(completedPomodoros);
  const settingsRef = useRef(settings);
  const isRunningRef = useRef(isRunning);
  // True while the user is dragging the slider — suppress tick updates to avoid fighting the thumb
  const isScrubbingRef = useRef(false);

  sessionTypeRef.current = sessionType;
  completedRef.current = completedPomodoros;
  settingsRef.current = settings;
  isRunningRef.current = isRunning;

  // Only reset displayed time when actual duration settings change, not on every poll-created object
  useEffect(() => {
    if (!isRunning) {
      setTimeRemaining(sessionDuration(sessionType, settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.workDuration, settings.shortBreakDuration, settings.longBreakDuration]);

  const advanceSession = useCallback((notify: boolean = true) => {
    const current = sessionTypeRef.current;
    const completed = completedRef.current;
    // If the timer ended more than 3 s ago, the screen was off and AlarmActivity already
    // played the sound — skip in-app sound/notification to avoid a duplicate when the
    // JS timer resumes after the screen turns back on.
    const overdueMs = endTimeRef.current ? Math.max(0, Date.now() - endTimeRef.current) : 0;
    const shouldNotify = notify && overdueMs < 3000;

    cancelScheduledNotifications();
    cancelAlarmActivity();
    if (shouldNotify) {
      playSound(current === 'work' ? 'work' : 'break', current === 'work' ? soundAssets.work : soundAssets.break);
      // On Android, AlarmService already posted the notification — skip to avoid duplicates
      if (Platform.OS !== 'android' || !NativeModules.AlarmSound) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Pomodoro',
            body: sessionLabel(current),
            sound: current === 'work' ? 'ding2.wav' : 'ding.wav',
          },
          trigger: { channelId: current === 'work' ? CHANNEL_WORK : CHANNEL_BREAK } as any,
        });
      }
    }

    endTimeRef.current = null;
    const autoStart = settingsRef.current.autoStart;

    if (current === 'work') {
      const newCount = completed + 1;
      setCompletedPomodoros(newCount);
      const next: SessionType = newCount % 4 === 0 ? 'longBreak' : 'shortBreak';
      setSessionType(next);
      setTimeRemaining(sessionDuration(next, settingsRef.current));
      onBreakStart();
    } else {
      setSessionType('work');
      setTimeRemaining(sessionDuration('work', settingsRef.current));
    }

    // Force a false→true transition so the isRunning effect always re-fires when auto-starting.
    // If the timer completed while running, setIsRunning(true) alone is a no-op (no state change).
    setIsRunning(false);
    if (autoStart) setTimeout(() => setIsRunning(true), 0);
  }, [onBreakStart]);

  const advanceSessionRef = useRef(advanceSession);
  advanceSessionRef.current = advanceSession;

  // Tick: derive timeRemaining from endTime so background time is accounted for
  const tick = useCallback(() => {
    if (!endTimeRef.current || isScrubbingRef.current) return;
    const remaining = Math.ceil((endTimeRef.current - Date.now()) / 1000);
    if (remaining <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      advanceSessionRef.current(true);
    } else {
      setTimeRemaining(remaining);
    }
  }, []);

  useEffect(() => {
    if (isRunning) {
      // Set endTime based on current timeRemaining if not already set
      if (!endTimeRef.current) {
        endTimeRef.current = Date.now() + timeRemaining * 1000;
      }
      // Schedule notification at the exact end time
      scheduleEndNotification(
        'Pomodoro',
        sessionLabel(sessionTypeRef.current),
        new Date(endTimeRef.current),
        sessionTypeRef.current
      );
      intervalRef.current = setInterval(tick, 500);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      cancelScheduledNotifications();
      cancelAlarmActivity();
      // Persist remaining time into endTime offset for next resume
      endTimeRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // When app returns to foreground while running, recalc immediately
  useEffect(() => {
    const handler = (nextState: AppStateStatus) => {
      if (nextState === 'active' && isRunningRef.current && endTimeRef.current) {
        tick();
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [tick]);

  const start = useCallback(() => {
    // endTimeRef is set fresh in the isRunning effect
    setIsRunning(true);
  }, []);

  const pause = useCallback(() => {
    // Save remaining time so resume continues from where we left off
    if (endTimeRef.current) {
      const remaining = Math.ceil((endTimeRef.current - Date.now()) / 1000);
      setTimeRemaining(Math.max(0, remaining));
    }
    endTimeRef.current = null;
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    endTimeRef.current = null;
    setIsRunning(false);
    setTimeRemaining(sessionDuration(sessionTypeRef.current, settingsRef.current));
  }, []);

  const skip = useCallback(() => {
    endTimeRef.current = null;
    setIsRunning(false);
    advanceSessionRef.current(false);
  }, []);

  // Live scrub: update display only, suppress tick updates while dragging
  const scrubTo = useCallback((seconds: number) => {
    isScrubbingRef.current = true;
    setTimeRemaining(Math.max(1, Math.round(seconds)));
  }, []);

  // Commit: clear scrub flag, update endTimeRef and reschedule notification
  const seekTo = useCallback((seconds: number) => {
    isScrubbingRef.current = false;
    const clamped = Math.max(1, Math.round(seconds));
    setTimeRemaining(clamped);
    if (isRunningRef.current) {
      endTimeRef.current = Date.now() + clamped * 1000;
      scheduleEndNotification(
        'Pomodoro',
        sessionLabel(sessionTypeRef.current),
        new Date(endTimeRef.current),
        sessionTypeRef.current
      );
    } else {
      endTimeRef.current = null;
    }
  }, []);

  const totalDuration = sessionDuration(sessionType, settingsRef.current);

  return { sessionType, timeRemaining, isRunning, completedPomodoros, sessionDurationSeconds: totalDuration, start, pause, reset, skip, seekTo, scrubTo };
}
