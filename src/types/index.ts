export type SessionType = 'work' | 'shortBreak' | 'longBreak';

export interface Settings {
  workDuration: number;       // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number;  // minutes
  autoStart: boolean;
  persistentNotification: boolean;
  diverseGroups: boolean;
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
  tags?: string[];
}

export const CHALLENGE_TAGS = ['long-break-only', 'short-break-only', 'once-a-day'] as const;
export type ChallengeTag = typeof CHALLENGE_TAGS[number];
export const TAG_LABELS: Record<ChallengeTag, string> = {
  'long-break-only': 'Long break',
  'short-break-only': 'Short break',
  'once-a-day': 'Once/day',
};
export const TAG_COLORS: Record<ChallengeTag, string> = {
  'long-break-only': '#1E88E5',
  'short-break-only': '#43A047',
  'once-a-day': '#FB8C00',
};

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  autoStart: false,
  persistentNotification: false,
  diverseGroups: true,
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
