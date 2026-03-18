# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Start Expo dev server
npm run android        # Launch on Android device/emulator

# Local build (Android SDK installed at ~/android-sdk)
bash build-pomo.sh     # Increments patch version, builds APK, copies to Dropbox. Use this — do NOT run eas build manually.
```

`build-pomo.sh` sets up env vars (`ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME`) and runs `eas build --local --clear-cache`. Android SDK at `~/android-sdk`, NDK at `~/android-sdk/ndk/26.1.10909125`, JDK 17 via apt. APK output goes to `build/`.

No linter or test suite is configured.

## Architecture

Expo React Native app (TypeScript) targeting Android primarily, with iOS support. Three bottom-tab screens: **Timer**, **Challenges**, **Settings**.

### Timer engine (`src/hooks/usePomodoro.ts`)

Uses a **wall-clock endTime** strategy: `endTimeRef` holds the absolute timestamp when the session ends (`Date.now() + remaining * 1000`). Ticks recompute `timeRemaining` from that reference so background time is automatically accounted for. An `AppState` listener triggers an immediate recalc on foreground resume.

On session end, `advanceSession` fires. It checks `overdueMs` (how long ago `endTime` passed) — if >3s, the screen was off and `AlarmActivity` already handled sound/notification, so in-app sound is skipped to avoid duplicates.

`isScrubbingRef` suppresses tick updates while the user drags the slider. Auto-start uses `setIsRunning(false)` + `setTimeout(() => setIsRunning(true), 0)` to force the `isRunning` effect to re-fire even when already `true`.

### Alarm system (`plugins/android/`)

On Android, alarms are handled natively — `expo-notifications` is intentionally skipped on Android to avoid double-firing.

**Flow when screen is off / app is in background:**
1. `AlarmSoundModule.scheduleAlarm()` calls `AlarmManager.setAlarmClock()` with a `getForegroundService()` `PendingIntent` targeting `AlarmService`.
2. `AlarmService` (ForegroundService) starts, acquires a `ACQUIRE_CAUSES_WAKEUP` WakeLock, calls `startForeground()` with a silent notification, then posts an alarm notification with `setFullScreenIntent()`.
3. If the device is **locked**: posts on `FSI_CHANNEL_ID` (IMPORTANCE_HIGH, silent) — FSI triggers `AlarmActivity` which plays sound via MediaPlayer.
4. If the device is **unlocked**: posts on the alarm channel (IMPORTANCE_MAX, with sound) — shows as a heads-up notification.
5. `AlarmService` sets `AlarmSoundModule.alarmActivityShowing = true` before launching the activity, so JS `play()` is skipped (prevents double sound).
6. If the app is **already in the foreground**, `AlarmService` bails immediately — JS handles sound via `expo-av`.

`AlarmActivity` auto-dismisses on sound completion, with a 5s fallback.

### Notification channels (`App.tsx`)

Two channels created at startup: `CHANNEL_WORK` (`pomo-work-4`) and `CHANNEL_BREAK` (`pomo-break-4`). Both use `importance: MAX`, `bypassDnd: true`, `audioAttributes: { usage: ALARM }`.

**Channel IDs are versioned** — increment the suffix (e.g. `-4` → `-5`) whenever sound or importance settings change, because Android permanently caches channel config after first creation. The suffix must also be updated in `AlarmService.kt` (`WORK_CHANNEL_ID` / `BREAK_CHANNEL_ID`).

Custom sounds (`ding.wav`, `ding2.wav`) must be declared in `app.json` under `plugins → expo-notifications → sounds`. Changing sounds requires a new native build.

### Config plugin (`plugins/withFullScreenIntent.js`)

Runs during `expo prebuild` (every EAS build). Reads Kotlin source files from `plugins/android/`, substitutes the package name (replacing `PACKAGE_NAME`), and writes them into the generated Android project. Also:

1. **Patches `ExpoNotificationBuilder.kt`** in node_modules to add `setCategory(CATEGORY_ALARM)`.
2. **Patches `MainApplication.kt`** to register `FullScreenIntentPackage`.
3. **Sets `gradle.properties`** entries:
   - `kotlin.compiler.execution.strategy=in-process` — prevents WSL2 Kotlin daemon deadlock
   - `org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g` — required for in-process compilation

### Data flow

Settings and challenges are persisted to AsyncStorage via `src/storage/storage.ts`. `TimerScreen` polls storage every second, guarded by JSON comparison so `setSettings`/`setChallenges` only fire when data actually changes (avoids unnecessary re-renders that would reset timer state).

Challenges have a `group` field; `pickChallenge` biases 75% toward a different group than the last shown.

### Key files

| File | Role |
|------|------|
| `App.tsx` | Notification channels, full-screen intent permission check, notification handler |
| `src/hooks/usePomodoro.ts` | All timer state, alarm scheduling, in-app sound |
| `src/screens/TimerScreen.tsx` | Timer UI, break challenge modal |
| `src/screens/ChallengesScreen.tsx` | Challenge/group CRUD |
| `src/screens/SettingsScreen.tsx` | Settings UI |
| `src/types/index.ts` | `SessionType`, `Settings`, `Challenge`, defaults |
| `src/storage/storage.ts` | AsyncStorage wrappers |
| `plugins/withFullScreenIntent.js` | Config plugin — copies Kotlin files, patches expo-notifications, configures Gradle |
| `plugins/android/AlarmService.kt` | ForegroundService — wakelock, FSI notification, foreground guard |
| `plugins/android/AlarmActivity.kt` | Full-screen UI shown over lock screen; plays sound, auto-dismisses |
| `plugins/android/AlarmSoundModule.kt` | RN native module — `play()`, `scheduleAlarm()`, `cancelAlarm()` |
| `plugins/android/FullScreenIntentModule.kt` | RN native module — `isGranted()`, `openSettings()` for USE_FULL_SCREEN_INTENT |
| `app.json` | Expo config — permissions, sound assets, EAS project ID |
| `eas.json` | Build profiles |
| `build-pomo.sh` | Local build script (gitignored) |
