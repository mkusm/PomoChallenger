# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Start Expo dev server
npm run android        # Launch on Android device/emulator
npm run ios            # Launch on iOS simulator

# Local build (Android SDK installed at ~/android-sdk)
bash build-pomo.sh     # Builds a preview APK locally and copies to Dropbox. Use this — do NOT run eas build manually.

# EAS cloud build (queues on Expo servers — can be slow)
eas build --platform android --profile preview --local   # local machine
eas build --platform android --profile preview           # cloud
```

`build-pomo.sh` sets up the required env vars (`ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME`) and runs `eas build --local`. Android SDK is at `~/android-sdk`, NDK at `~/android-sdk/ndk/26.1.10909125`, JDK 17 via apt.

No linter or test suite is configured.

## Architecture

Expo React Native app (TypeScript) targeting Android primarily, with iOS support. Three bottom-tab screens: **Timer**, **Challenges**, **Settings**.

### Timer engine (`src/hooks/usePomodoro.ts`)

The core logic uses a **wall-clock endTime** strategy: when the timer starts, an absolute `endTimeRef` is set (`Date.now() + remaining * 1000`), and ticks recompute `timeRemaining` from that reference. This ensures background time is automatically accounted for when the app resumes. AppState listener triggers a recalc on foreground.

On session end, `advanceSession` fires: plays an in-app sound via `expo-av` AND fires an immediate `expo-notifications` notification (for lock screen / background). A scheduled notification is also set at `endTime` when the timer starts, so the lock screen gets notified even if the app is killed.

### Notifications & sound (`App.tsx` + `usePomodoro.ts`)

- Android notification channels are created in `App.tsx` on startup: `CHANNEL_WORK` (`pomo-work-3`) and `CHANNEL_BREAK` (`pomo-break-3`). Channel IDs are versioned — **increment the suffix** to force Android to recreate the channel when sound/importance settings change (Android permanently caches channel config after first creation).
- Channels use `importance: MAX`, `lockscreenVisibility: PUBLIC`, `bypassDnd: true` so notifications behave like alarms.
- Custom sound files (`ding.wav`, `ding2.wav`) must be declared in **both** `app.json` under `plugins → expo-notifications → sounds` **and** referenced in the channel `sound` field in `App.tsx`. Changing sounds requires a new native build.
- In-app audio uses `expo-av`. This does **not** play when the screen is locked — lock-screen sound comes from the notification channel.

### Config plugin (`plugins/withFullScreenIntent.js`)

Runs during `expo prebuild` (i.e. as part of every EAS build) and does three things:

1. **Patches `ExpoNotificationBuilder.kt`** in node_modules to add `builder.setFullScreenIntent(pendingIntent, true)` — makes notifications take over the full screen when the device is locked.
2. **Creates two Kotlin files** in the generated Android project (`FullScreenIntentModule.kt`, `FullScreenIntentPackage.kt`) — a React Native native module exposing `isGranted()` and `openSettings()` for the `USE_FULL_SCREEN_INTENT` permission.
3. **Patches `MainApplication.kt`** to register the native module, and sets `gradle.properties` entries:
   - `kotlin.compiler.execution.strategy=in-process` — prevents a WSL2-specific deadlock where the Kotlin compiler daemon hangs indefinitely
   - `org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g` — required because in-process compilation loads Kotlin compiler classes into the Gradle JVM's metaspace

`App.tsx` calls `NativeModules.FullScreenIntent.isGranted()` on launch and on every foreground resume. On Android 14+ if not granted, it shows an Alert prompting the user to open the `USE_FULL_SCREEN_INTENT` settings page.

### Data flow

Settings and challenges are persisted to AsyncStorage via `src/storage/storage.ts`. `TimerScreen` polls storage every second to pick up changes from other tabs. Challenges have a `group` field; `pickChallenge` biases 75% toward a different group than the last shown.

### Key files

| File | Role |
|------|------|
| `App.tsx` | Notification handler, Android channel setup, exported channel ID constants, full-screen intent permission check |
| `src/hooks/usePomodoro.ts` | All timer state, notification scheduling, sound playback |
| `src/screens/TimerScreen.tsx` | UI, challenge modal (full-screen `Modal`) |
| `src/types/index.ts` | `SessionType`, `Settings`, `Challenge`, defaults |
| `plugins/withFullScreenIntent.js` | Config plugin — patches expo-notifications for full-screen intent + native module |
| `app.json` | Expo config — sound assets, Android permissions, EAS project ID |
| `eas.json` | Build profiles (development, preview APK, production) |
| `build-pomo.sh` | Local build script (gitignored, machine-specific paths) |
