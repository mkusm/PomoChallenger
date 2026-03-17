import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { SessionType, Settings } from '../types';
import { CHANNEL_WORK, CHANNEL_BREAK } from '../../App';

const soundAssets = {
  work: require('../../assets/ding2.wav'),
  break: require('../../assets/ding.wav'),
};

async function playSound(asset: ReturnType<typeof require>) {
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
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId },
  });
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

  sessionTypeRef.current = sessionType;
  completedRef.current = completedPomodoros;
  settingsRef.current = settings;
  isRunningRef.current = isRunning;

  useEffect(() => {
    if (!isRunning) {
      setTimeRemaining(sessionDuration(sessionType, settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const advanceSession = useCallback((notify: boolean = true) => {
    const current = sessionTypeRef.current;
    const completed = completedRef.current;

    cancelScheduledNotifications();
    if (notify) {
      playSound(current === 'work' ? soundAssets.work : soundAssets.break);
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Pomodoro',
          body: sessionLabel(current),
          sound: current === 'work' ? 'ding2.wav' : 'ding.wav',
        },
        trigger: { channelId: current === 'work' ? CHANNEL_WORK : CHANNEL_BREAK } as any,
      });
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
    setIsRunning(autoStart);
  }, [onBreakStart]);

  const advanceSessionRef = useRef(advanceSession);
  advanceSessionRef.current = advanceSession;

  // Tick: derive timeRemaining from endTime so background time is accounted for
  const tick = useCallback(() => {
    if (!endTimeRef.current) return;
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

  // Live scrub: update display only, don't touch endTimeRef or notifications
  const scrubTo = useCallback((seconds: number) => {
    setTimeRemaining(Math.max(1, Math.round(seconds)));
  }, []);

  // Commit: update endTimeRef and reschedule notification
  const seekTo = useCallback((seconds: number) => {
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
