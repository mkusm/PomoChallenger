# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Start Expo dev server
npm run android        # Launch on Android device/emulator

# Local build (Android SDK installed at ~/android-sdk)
bash build-pomo.sh     # Increments patch version, builds APK, copies to Dropbox. Use this — do NOT run eas build manually.
```

`build-pomo.sh` sets up env vars (`ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME`) and runs `eas build --local --clear-cache`. Android SDK at `~/android-sdk`, NDK at `~/android-sdk/ndk/26.1.10909125`, JDK 17 via apt. APK output goes to `build/`. It runs `tsc --noEmit` first and aborts on type errors.

```bash
npm run typecheck      # tsc --noEmit
npm test               # jest (ts-jest; covers pure logic in src/logic)
```

Tests use a lightweight ts-jest config (`jest.config.js`), not jest-expo — so only pure modules under `src/logic` are covered. Component/native tests would need a separate RN preset. No linter is configured.

## Testing on a physical device (Android, via WSL)

The dev machine is WSL2; the phone (Pixel 8) plugs into Windows. What works:

**Connection — usbipd-win + root adb server.**
- On Windows: `usbipd bind --busid <X>` (once), then `usbipd attach --wsl --busid <X>` (every reconnect/reboot). Enable **USB debugging** on the phone first — the USB product id must be `18d1:4ee7` (adb present), not `4ee1` (MTP only). After enabling debugging, re-attach so WSL re-enumerates.
- Attach keeps dropping (`vhci_hcd: connection reset by peer`) if **Phone Link / Android Studio** on Windows grabs the device, or on a USB-3 port. Fix: close Phone Link and use a **USB 2.0 port**.
- This WSL runs legacy `init` (no systemd → **no udevd**), so usbipd device nodes are root-only (`crw------- root root`). The adb *server* must run as root or `adb devices` is empty: `sudo adb kill-server; sudo adb start-server`. The client (`adb devices`, `adb install`, …) stays as your user. Re-run after each reboot/attach. (`ADB_SERVER_SOCKET` bridging to the Windows adb server does **not** work here — NAT networking can't route to the Windows LAN IP; see the fish-config comment.)

**Driving the UI headlessly.**
- Screenshot: `adb exec-out screencap -p > shot.png` (use `exec-out`, not `shell screencap`, to avoid CRLF corruption).
- Precise taps: `adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml` gives element `bounds="[x1,y1][x2,y2]"` — tap the center. RN `EditText`s show their value as `text=`.
- Input: `adb shell input tap X Y` / `input text "25"` / `input keyevent KEYCODE_DEL|KEYCODE_MOVE_END|KEYCODE_BACK`. Duration fields commit on blur (`onEndEditing`) — after typing, `KEYCODE_BACK` to close the keyboard, then tap another control to force the commit.
- Settings persist to AsyncStorage; a release build isn't debuggable so `run-as` can't read it — verify persistence by `am force-stop` + relaunch and reading the UI.

**Testing the alarm quickly.**
- Set Work to 1 min in Settings so a session ends in ~60s. Turn Auto-start off for a clean single-fire.
- Lock/sleep: `adb shell input keyevent KEYCODE_SLEEP`; confirm it's really off with `adb shell dumpsys power | grep mWakefulness` (`Dozing`/`Asleep`). **Lock before the session ends** — if the app is foregrounded at end, `AlarmService` bails and JS plays instead, so you're testing the wrong path.
- Capture with `adb logcat -d`. Key signals: `Background started FGS … AlarmService … ALARM_MANAGER_ALARM_CLOCK` (native alarm fired); `START … com.kusm.pomo/.AlarmActivity` (FSI/locked path taken); **count `MediaPlayer: resetDrmState` — exactly one = single sound, two = double-sound bug**. App logs are under tag `Pomo` (`adb logcat -s Pomo:*`).
- Long operations (a ~15 min local build) drop the usbip attach when the phone sleeps — enable Developer options → "Stay awake", and re-`usbipd attach` before installing.

## Architecture

Expo React Native app (TypeScript) targeting Android primarily, with iOS support. Three bottom-tab screens: **Timer**, **Challenges**, **Settings**.

### Timer engine (`src/hooks/usePomodoro.ts`)

Uses a **wall-clock endTime** strategy: `endTimeRef` holds the absolute timestamp when the session ends (`Date.now() + remaining * 1000`). Ticks recompute `timeRemaining` from that reference so background time is automatically accounted for. An `AppState` listener triggers an immediate recalc on foreground resume.

On session end, `advanceSession` fires. It checks `overdueMs` (how long ago `endTime` passed) — if >3s, the screen was off and `AlarmActivity` already handled sound/notification, so in-app sound is skipped to avoid duplicates.

`isScrubbingRef` suppresses tick updates while the user drags the slider. Auto-start uses `setIsRunning(false)` + `setTimeout(() => setIsRunning(true), 0)` to force the `isRunning` effect to re-fire even when already `true`.

### Alarm system (`plugins/android/`)

On Android, alarms are handled natively — `expo-notifications` is intentionally skipped on Android to avoid double-firing.

**`AlarmService` is the single end-of-session sound authority on Android — JS never plays sound.** The countdown foreground-service keeps the JS timer ticking even while locked, and JS can't reliably tell it's backgrounded (MainActivity is `showWhenLocked`, so the wakelock makes `AppState` read `active` even on the lock screen). So sound is routed entirely through `AlarmService`, which picks the mechanism by `isAppInForeground()`: in-process `AlarmSoundModule.play()` when foregrounded, `AlarmActivity` when locked, or the notification channel when unlocked. This removes the JS-vs-native double-sound race. (`advanceSession` in `usePomodoro` still runs the JS UI — e.g. the break-challenge modal — but does not play or post on Android.)

**Flow when screen is off / app is in background:**
1. `AlarmSoundModule.scheduleAlarm()` calls `AlarmManager.setAlarmClock()` with a `getForegroundService()` `PendingIntent` targeting `AlarmService`.
2. `AlarmService` (ForegroundService) starts, acquires a `ACQUIRE_CAUSES_WAKEUP` WakeLock, calls `startForeground()` with a silent notification, then posts an alarm notification with `setFullScreenIntent()`.
3. If the device is **locked** and full-screen-intent permission is granted (`canUseFullScreenIntent()` on API 34+): posts on `FSI_CHANNEL_ID` (IMPORTANCE_HIGH, silent) — FSI triggers `AlarmActivity` which plays sound via MediaPlayer. This is the "FSI path".
4. Otherwise (device **unlocked**, or locked but FSI permission denied): posts on the alarm channel (IMPORTANCE_MAX, with sound) — shows as a heads-up notification and the channel plays the sound. The locked-but-denied fallback exists so the alarm is never silent.
5. Only on the FSI path does `AlarmService` set `AlarmSoundModule.alarmActivityShowing = true` (so JS/activity `play()` is skipped to prevent double sound). On the non-FSI path it sets the flag `false` and, after ~3 s, releases the wakelock and stops the foreground service (the alarm notification, a separate id, stays). The flag is also reset in `scheduleAlarm()`/`cancelAlarm()` so it can never get stuck and mute future sounds.
6. If the app is **already in the foreground**, `AlarmService` plays the sound in-process via `AlarmSoundModule.play()` (STREAM_ALARM), then stops — no full-screen activity or notification (the JS UI shows the break challenge). JS stays silent.

Both `AlarmService` and `CountdownService` run as `foregroundServiceType="specialUse"` (not `mediaPlayback` — neither plays media through the *service*; there's no standard FGS type for an alarm/timer). This needs the `FOREGROUND_SERVICE_SPECIAL_USE` permission and a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` `<property>` on each service (added by the config plugin), and a one-line justification in the Play Console form at submission. `startForeground` passes the `SPECIAL_USE` type only on API 34+ (unenforced below).

`sessionType`/`isBreak` and the sound filename are passed as explicit intent extras from JS (`scheduleAlarm(..., isBreak)`) through `AlarmService` to `AlarmActivity` — the native side never infers session type from the (localizable) notification body text.

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
