export type SessionType = 'work' | 'shortBreak' | 'longBreak';

export interface Settings {
  workDuration: number;       // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number;  // minutes
}

export interface PomodoroState {
  sessionType: SessionType;
  timeRemaining: number; // seconds
  isRunning: boolean;
  completedPomodoros: number;
}

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
};

export const DEFAULT_CHALLENGES: string[] = [
  'Do 20 pushups',
  'Drink a glass of water',
  'Clean something nearby',
  'Take a short walk',
  'Do 10 deep breaths',
];
