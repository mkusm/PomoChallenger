import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { SessionType, Settings, DEFAULT_SETTINGS } from '../types';

interface UsePomodoroOptions {
  settings: Settings;
  onBreakStart: () => void; // called so UI can pick a challenge
}

interface UsePomodoroReturn {
  sessionType: SessionType;
  timeRemaining: number;
  isRunning: boolean;
  completedPomodoros: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
}

function sessionDuration(type: SessionType, settings: Settings): number {
  switch (type) {
    case 'work':
      return settings.workDuration * 60;
    case 'shortBreak':
      return settings.shortBreakDuration * 60;
    case 'longBreak':
      return settings.longBreakDuration * 60;
  }
}

function sessionLabel(type: SessionType): string {
  switch (type) {
    case 'work':
      return 'Work session complete! Time for a break.';
    case 'shortBreak':
    case 'longBreak':
      return 'Break over! Back to work.';
  }
}

async function scheduleNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null, // fire immediately
  });
}

export function usePomodoro({ settings, onBreakStart }: UsePomodoroOptions): UsePomodoroReturn {
  const [sessionType, setSessionType] = useState<SessionType>('work');
  const [timeRemaining, setTimeRemaining] = useState<number>(
    sessionDuration('work', settings)
  );
  const [isRunning, setIsRunning] = useState(false);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionTypeRef = useRef(sessionType);
  const completedRef = useRef(completedPomodoros);
  const settingsRef = useRef(settings);

  sessionTypeRef.current = sessionType;
  completedRef.current = completedPomodoros;
  settingsRef.current = settings;

  // When settings change, reset the current session duration if not running
  useEffect(() => {
    if (!isRunning) {
      setTimeRemaining(sessionDuration(sessionType, settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const advanceSession = useCallback(() => {
    const current = sessionTypeRef.current;
    const completed = completedRef.current;

    scheduleNotification('Pomodoro', sessionLabel(current));

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
    setIsRunning(false);
  }, [onBreakStart]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            advanceSession();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, advanceSession]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setTimeRemaining(sessionDuration(sessionTypeRef.current, settingsRef.current));
  }, []);

  const skip = useCallback(() => {
    setIsRunning(false);
    advanceSession();
  }, [advanceSession]);

  return { sessionType, timeRemaining, isRunning, completedPomodoros, start, pause, reset, skip };
}
