# Pomo — Project Re-evaluation

*Date: 2026-07-12. Scope: full codebase (`src/`, `plugins/`, `App.tsx`, config, repo hygiene). Everything below is "what I would have changed", ordered by how much it matters.*

## Verdict in one paragraph

The core design is sound: wall-clock `endTime` for the timer, native `setAlarmClock()` + ForegroundService + full-screen intent for reliable alarms, and a config plugin so the Kotlin survives `expo prebuild`. Those were the hard problems and they're solved correctly. What's weak is everything around the core: there are several real bugs (a stuck `alarmActivityShowing` flag that can mute the app, a silent-alarm path when FSI is denied, a 25% no-challenge edge case, TypeScript that doesn't compile), a battery-hostile 1s storage poll as the cross-screen data mechanism, no persistence of timer state across process death, zero tests, and fragile string-based coupling between JS and Kotlin (`body.startsWith("Break")`).

---

## Implementation status — updated 2026-07-12

Implemented and **verified on a physical Pixel 8** over adb (see `CLAUDE.md` → "Testing on a physical device"):

- ✅ **§1.1–1.3** native alarm bugs: stuck `alarmActivityShowing` flag, wakelock/service leak, FSI-denied silent-alarm fallback.
- ✅ **§1.4** `pickChallenge` empty-pool — extracted to `src/logic/pickChallenge.ts` with 10 jest tests.
- ✅ **§1.5** TypeScript errors in `App.tsx` — `tsc --noEmit` clean; typecheck gate added to `build-pomo.sh`.
- ✅ **§2.1** focus-based reload replacing the 1s poll (see loose end below).
- ✅ **§2.2** explicit `isBreak`/`sound` intent extras — no more `body.startsWith`.
- ✅ **§3** ts-jest setup + tests, Kotlin `Log.w` on all catches, `.gitignore`/`package.json` hygiene.
- ✅ **§4** storage shape-validation, atomic factory reset, `trigger: null`, direct Kotlin class refs, `CountdownService` explicit `isPaused` + progress math, slider helper, unused-import removal.
- ✅ **§1.7** persist timer state across process death — the running-session snapshot (`endTime`, `sessionType`, `completedPomodoros`, `isRunning`) is saved on every transition and restored on launch. Scoped to only resume a session that was genuinely mid-countdown when killed, so idle/stale states fall through to a fresh start. Verified on-device: force-stop mid-session → reopened → resumed counting from the right remaining time.
- ✅ **§2.5** foreground-service types — both services were falsely typed `mediaPlayback` (neither plays media through the service). Switched to `specialUse` (+ `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property + `FOREGROUND_SERVICE_SPECIAL_USE` permission). Verified on-device (Android 16): both services start with **no FGS exceptions**; aapt2 confirms the merged manifest. **Play note:** `specialUse` requires a short justification in the Play Console submission form.
- ✅ **Bonus (found on-device):** locked-screen **double sound** — the countdown foreground-service keeps the JS timer ticking while locked, so JS `play()` and `AlarmActivity` both fired. An `AppState === 'active'` guard proved *unreliable*: MainActivity is `showWhenLocked`, so the wakelock makes the app read "active" even locked — the race was a coin flip (passed once, failed later). Final fix makes **`AlarmService` the single sound authority**: JS never plays on Android; the service plays in-process when foregrounded, via `AlarmActivity` when locked, or via the notification channel when unlocked. Verified on-device: **exactly 1 MediaPlayer in both the locked and foreground paths** (challenge modal still shows in foreground).
- ✅ **§2.1 loose end resolved:** changing a duration on Settings now reflects on the Timer immediately — `saveSettings`/`saveChallenges` emit a `DeviceEventEmitter` event that TimerScreen reloads on, closing the blur-commit vs focus-read race. Verified on-device (Timer showed the new value instantly).

**Deferred** (larger refactors / lower value):
- §1.6 native next-alarm scheduling.
- §2.3 dedupe notification builders; §2.4 `usePomodoro` reducer refactor; `expo-av` → `expo-audio`.

---

## 1. Bugs I found (would fix first)

### 1.1 `alarmActivityShowing` can get stuck `true` → app goes permanently silent
`AlarmService.kt:127` sets `AlarmSoundModule.alarmActivityShowing = true` unconditionally at the end of `onStartCommand`. The flag is only reset in `AlarmActivity.onDestroy` (`AlarmActivity.kt:135`). But in the **unlocked** path the notification is a heads-up — `AlarmActivity` only launches if the user taps it. If they never tap (they just swipe the notification away or ignore it), the flag stays `true` for the life of the process and every future `play()` call is skipped (`AlarmSoundModule.kt:46`). Every subsequent in-app session end is silent until the app is killed.

**Fix:** only set the flag on the locked/FSI path, or reset it with a timeout, or reset it in `scheduleAlarm()`/`cancelAlarm()`.

### 1.2 Same path leaks the wakelock and the foreground service
In the unlocked-no-tap scenario, `AlarmService` never calls `stopSelf()` — only `AlarmActivity.dismissAlarm()` stops it. The service sits in the foreground with its silent "Timer ended" notification, and the `SCREEN_BRIGHT_WAKE_LOCK` burns for its full 10-minute timeout. The service should stop itself (and release the lock) once the notification is posted in the unlocked path, or use a short watchdog.

### 1.3 Locked device + FSI permission denied = completely silent alarm
When locked, the alarm notification goes to `FSI_CHANNEL_ID`, which is deliberately **silent** because `AlarmActivity` is expected to play the sound (`AlarmService.kt:80-108`). If the user tapped "Not now" on the FSI permission alert, the FSI never fires, the activity never plays sound, and the user gets a silent notification on a locked phone — the one scenario the whole native stack exists for. **Fix:** check `FullScreenIntentModule.isGranted()`-equivalent (`NotificationManager.canUseFullScreenIntent()` on API 34+) in `AlarmService` and fall back to the sounding work/break channel when FSI is unavailable.

### 1.4 `pickChallenge` returns `undefined` ~25% of the time in a common configuration
`TimerScreen.tsx:70-74`: when `diverseGroups` is on and **all** eligible challenges are in a different group than `lastGroup`, `same` is empty. With probability 0.25 (`Math.random() >= 0.75`), `useDifferent` is false, `pool` is `[]`, and `pool[...]` is `undefined` — no challenge modal shown at all. The function is typed `Challenge | null` so TypeScript doesn't catch it. **Fix:** `const pool = useDifferent ? different : (same.length ? same : different)`.

### 1.5 TypeScript doesn't compile
`npx tsc --noEmit` fails with 2 errors in `App.tsx:70,80` — the `audioAttributes.flags` keys are wrong (`enforced`/`requestHardwareAV` instead of `enforceAudibility`/`requestHardwareAudioVideoSynchronization`). This isn't just a type nit: the values you intended to set are silently ignored at runtime. With no CI, no lint, and no typecheck script, this has been shipping. **Fix the keys and add a `"typecheck": "tsc --noEmit"` script** (ideally run it in `build-pomo.sh` before the Gradle build).

### 1.6 Auto-start chain breaks when the screen is off
`advanceSession` schedules the *next* session's alarm from JS (`setTimeout(() => setIsRunning(true), 0)` → `isRunning` effect → `scheduleAlarm`). If the device is asleep when a session ends, `AlarmService` fires the alarm, but the JS side may be frozen (Doze) — so with `autoStart` on, the next session's native alarm isn't scheduled until the app comes back to the foreground. The countdown notification keeps a foreground service alive which mitigates this, but only while running. If reliable back-to-back sessions matter, the *next* alarm should be scheduled natively at the moment the current one fires.

### 1.7 Timer state doesn't survive process death
All session state (`sessionType`, `completedPomodoros`, `endTimeRef`) lives in React state/refs. If Android kills the process mid-session (common on aggressive OEMs), the scheduled `AlarmManager` alarm still fires — but reopening the app shows a fresh 25:00 work session with 0 pomodoros. I would persist `{ endTime, sessionType, completedPomodoros, isRunning }` to AsyncStorage on every transition and rehydrate in `usePomodoro`.

---

## 2. Architecture — what I'd restructure

### 2.1 Kill the 1-second storage poll
`TimerScreen.tsx:100-110` polls AsyncStorage every second, forever, guarded by `JSON.stringify` comparison — to detect settings edits made on another tab. That's ~86k reads+serializations a day to observe an event that happens a few times a week. The idiomatic fixes, in ascending effort:
1. `useFocusEffect` — reload when the Timer tab regains focus (settings can only change while you're on another tab). ~5 lines, deletes the poll and both JSON refs.
2. A tiny shared store (React context or zustand) as the single source of truth, with AsyncStorage as write-through persistence. This also removes the `settingsRef`/`settingsJsonRef` plumbing and the "guarded by JSON comparison" caveat documented in CLAUDE.md.

### 2.2 Stop deriving semantics from notification body text
`isBreak = body.startsWith("Break")` appears in both `AlarmService.kt:107` and `AlarmActivity.kt:43`. The UI copy is now a protocol: rewording "Break over!" or localizing the app silently breaks channel selection, the emoji, the title, and which sound plays. The `sound` extra is even passed into the intent (`AlarmSoundModule.kt:76`) and then **never read** — the activity re-derives it from the body string. Pass an explicit `isBreak`/`sessionType` extra end-to-end and delete the string sniffing.

### 2.3 Deduplicate the notification builders
`AlarmSoundModule.showIdleNotification` (~50 lines) is a copy of `CountdownService.buildNotif` with progress pinned to full and the button pinned to play. One `buildCountdownNotification(ctx, remainingMs, totalMs, label, isBreak, paused)` helper would remove the duplication and the risk of the two drifting (they already differ subtly in how they resolve layout IDs).

### 2.4 `usePomodoro` mixes three concerns
The hook owns timer math, notification orchestration (5 wrapper functions), and sound. It works, but the ref-mirroring pattern (`sessionTypeRef`, `completedRef`, `settingsRef`, `isRunningRef`, `advanceSessionRef`, `pauseRef`, `startRef` — 7 refs shadowing state) is the tell that the effect/state design is fighting React. A `useReducer` for the session state machine plus a separate `useAlarmNotifications(state)` effect layer would cut most of the refs and make transitions (`idle → running → paused → next`) explicit and unit-testable.

### 2.5 Foreground service types are wrong for Android 14+
Both services declare `foregroundServiceType="mediaPlayback"` (`withFullScreenIntent.js:127,138`) but neither plays media (the alarm sound comes from `AlarmActivity`, not the service). On targetSdk 34+, Google Play reviews FGS type justifications and the OS can throw `MismatchedForegroundServiceTypeException`. `AlarmService` launched via `setAlarmClock()` qualifies for `systemExempted`; `CountdownService` is the harder one — the honest answer is `specialUse` with a declaration, or replacing the ticking service with `setContentText` + `setUsesChronometer(true)`/`setWhen()` so the OS renders the countdown and **no service is needed at all** (this would delete most of `CountdownService`).

---

## 3. Quality infrastructure — the missing safety net

- **No tests.** `pickChallenge` is a pure function with a known bug (§1.4) — it's the poster child for extraction into `src/logic/pickChallenge.ts` + Jest (`jest-expo` is a 10-minute setup). Timer-state transitions would be next. The Maestro E2E plan in `POSSIBLE_TEST_SETUP.md` is good; I'd land the two flows it sketches, but unit tests are cheaper and catch more per line.
- **No lint/typecheck gate.** ESLint + the existing `tsc` wired into `build-pomo.sh` would have caught §1.5 and the unused `TAG_COLORS` import in `TimerScreen.tsx:13`.
- **Silent `catch (_: Exception) {}` everywhere in Kotlin** (12 occurrences). Reasonable to not crash, but at least `Log.w("Pomo", e)` — right now a broken alarm on some OEM is undiagnosable.
- **Repo hygiene:** `pomo.png:Zone.Identifier` (WSL junk — add `*:Zone.Identifier` to `.gitignore`), `firebase-debug.log`, `assets_old/`, and a large uncommitted diff including a whole new file (`CountdownService.kt`). `package.json` still says `"name": "pomo-init", "version": "1.0.0"` while `app.json` carries the real version — the build script bumps only one of them.
- **`expo-av` is deprecated** in SDK 54 in favor of `expo-audio`. It's only the iOS/fallback sound path, but it will block the next SDK upgrade.

## 4. Smaller things I'd change

| Where | What |
|---|---|
| `usePomodoro.ts:186` | `trigger: {...} as any` — the cast hides that a channel-only trigger isn't a valid immediate-notification shape; use `trigger: null` with the channel in content. |
| `usePomodoro.ts:199` | `newCount % 4` — the long-break cadence is hardcoded; it's a natural setting and the "4" is duplicated in `TimerScreen`'s dot row. |
| `CountdownService.kt:116` | `(remainingSec * 1000L) / (totalMs / 1000L)` — works out to ‰ progress but only by unit coincidence; write `(remainingMs * 1000 / totalMs)`. |
| `CountdownService.kt:110` | `isPaused = pausedRemainingMs > 0` — pausing with <1s left renders as not-paused; use a boolean. |
| `AlarmSoundModule.kt:73` | `Class.forName("${ctx.packageName}.AlarmService")` — same package; reference `AlarmService::class.java` directly. |
| `storage.ts:42` | `parsed as Challenge[]` with no shape validation — corrupt storage propagates instead of falling back to defaults like every other loader. |
| `SettingsScreen.tsx:106` | Factory reset does `AsyncStorage.clear()` then re-seeds — if the app is killed between the two, next launch has empty groups. `multiSet` after clear, or just `multiRemove` the known keys. |
| `TimerScreen.tsx:192-194` | The inverted slider math (`sessionDurationSeconds - v + 1`) appears three times; one `toRemaining(v)` helper. |
| `App.tsx` channel IDs | The `-4` suffix must be manually kept in sync with `AlarmService.kt` (documented in CLAUDE.md as a footgun). The config plugin already rewrites the Kotlin — have it inject the channel IDs from one JS constant. |
| Dots row | `completedPomodoros % 4` shows 0 dots right after the 4th pomodoro's long break starts — arguably should show 4 until the cycle actually restarts. |

## 5. What I would *not* change

- The wall-clock `endTime` timer strategy — correct and simpler than any tick-accumulation alternative.
- `setAlarmClock()` + `getForegroundService()` + FSI — this is the right (and roughly only) reliable alarm path on modern Android without `SCHEDULE_EXACT_ALARM` headaches.
- The locked/unlocked channel split to avoid double sound — subtle, well-commented, correct in the happy paths.
- The config-plugin approach of shipping Kotlin in `plugins/android/` and stamping the package name — pragmatic and survives prebuild, which is the whole game with Expo.
- Keeping the app dependency-light (no state library *yet*, no UI kit) — at 2.8k lines that's a feature.

## Suggested order of attack

1. ✅ Fix the four correctness bugs: stuck `alarmActivityShowing` + wakelock/service leak (§1.1–1.2), FSI-denied silent alarm (§1.3), `pickChallenge` empty pool (§1.4), TS errors (§1.5).
2. ✅ Commit the pending work.
3. ✅ Add `tsc --noEmit` to the build script; extract `pickChallenge` and unit-test it. *(ESLint still not configured.)*
4. ✅ Replace the 1s poll with focus-based reload (blur-commit vs focus-read race later closed with a storage-change event).
5. ✅ Persist timer state across process death.
6. ✅ Address FGS types — now `specialUse` (add a one-line justification in the Play Console form at submission).
