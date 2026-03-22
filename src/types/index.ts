export type SessionType = 'work' | 'shortBreak' | 'longBreak';

export interface Settings {
  workDuration: number;       // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number;  // minutes
  autoStart: boolean;
  persistentNotification: boolean;
}

export interface PomodoroState {
  sessionType: SessionType;
  timeRemaining: number; // seconds
  isRunning: boolean;
  completedPomodoros: number;
}

export interface Challenge {
  id: string;
  text: string;
  group: string;
}

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  autoStart: false,
  persistentNotification: false,
};

export const DEFAULT_GROUPS: string[] = ['Fitness', 'Home'];

export const DEFAULT_CHALLENGES: Challenge[] = [
  { id: '1', text: 'Do 20 pushups', group: 'Fitness' },
  { id: '3', text: '30 squats', group: 'Fitness' },
  { id: '4', text: '10 pull ups', group: 'Fitness' },
  { id: '5', text: 'Clean something nearby', group: 'Home' },
  { id: '6', text: 'Dishes', group: 'Home' },
  { id: '7', text: 'Laundry', group: 'Home' },
];
