# Design: Insistent Alarm ("Don't let me ignore it")

*A togglable mode that escalates the end-of-session alert until the user explicitly acknowledges it, instead of the current one-shot ding + auto-dismissing screen.*

## 1. Problem

Today the alarm plays the sound once (~2s) and `AlarmActivity` auto-dismisses after the sound completes (5s fallback). If the phone is across the room, in a pocket, or the user is mid-conversation, the entire alert window is a couple of seconds. A pomodoro app whose alarm can be missed defeats its purpose — the user wanted a hard interrupt.

## 2. Goals / non-goals

**Goals**
- When enabled, the end-of-session alert keeps demanding attention until the user dismisses it.
- Works in all three existing paths: locked screen (FSI → `AlarmActivity`), unlocked background (heads-up notification), app in foreground (JS).
- Off by default; single toggle in Settings.
- Hard safety timeout so a phone left on a desk doesn't strobe and blare for an hour.

**Non-goals**
- Per-session-type configuration (work vs break) — one global toggle for v1.
- Gradual volume ramp-up (nice v2; MediaPlayer `setVolume` loop).
- iOS — this is Android-native territory, same as the rest of the alarm stack. iOS keeps current behavior.

## 3. Attention mechanisms — evaluation

| Mechanism | API | Permission | Verdict |
|---|---|---|---|
| **Looping alarm sound** | `MediaPlayer.isLooping = true` | none new | ✅ Core of the feature. Highest attention-per-effort. |
| **Repeating vibration** | `Vibrator.vibrate(waveform, repeat=0)` | `VIBRATE` (already declared) | ✅ Include. Covers phone-in-pocket and low-volume cases. |
| **Screen flash (UI pulse)** | `ValueAnimator` on `AlarmActivity` background color | none | ✅ Include. Cheap, works over lock screen, big peripheral-vision signal. Alternate the root background `#121212 ↔ session color` at ~1.5 Hz. |
| **Camera flashlight strobe** | `CameraManager.setTorchMode()` | none (torch needs no runtime permission) | ⚠️ v2, own sub-toggle. Genuinely effective face-down-on-desk, but: fails silently if camera in use, some OEMs throttle rapid toggling, and it drains battery. Don't gate v1 on it. |
| `FLAG_INSISTENT` on notification | `Notification.flags` | none | ✅ Use for the **unlocked heads-up** path — the OS loops the channel sound/vibration natively until the notification is dismissed. Exactly built for this. |
| Max out alarm volume programmatically | `AudioManager.setStreamVolume` | none / DND-access on some OEMs | ❌ Rejected. Overriding user volume is hostile; alarm stream is already the right stream. |
| TTS announcement | `TextToSpeech` | none | ❌ Rejected. Init latency, language issues, low added value over a looping alarm. |

**v1 = looping sound + repeating vibration + pulsing `AlarmActivity` + `FLAG_INSISTENT`, all behind one toggle.** Torch strobe is a designed-but-deferred v2 sub-toggle.

## 4. UX

### Setting
Settings → Behaviour section, below "Always-on notification":

> **Insistent alarm** — Keep sounding and flashing until you dismiss the alert

`Switch`, same styling as existing toggles. Default **off**.

### Behavior when ON, by path

**A. Locked / screen off (FSI → `AlarmActivity`)**
- `AlarmActivity` loops the sound, runs a repeating vibration waveform (e.g. `[0, 400, 300, 400, 1200]`, repeat), and pulses the background color.
- **No auto-dismiss.** The 5s fallback and on-completion dismiss are disabled in this mode. Instead the activity shows a large **"Dismiss"** button (reuse the visual language of the Timer screen's white pill button).
- Safety timeout: after **60 s** (constant, `INSISTENT_TIMEOUT_MS`), stop sound/vibration/pulse, then run the normal dismiss path. The notification stays in the shade.

**B. Unlocked, app in background (heads-up notification)**
- Post on a **new** channel pair (see §6 — channel settings are immutable, so this needs new IDs) and set `Notification.FLAG_INSISTENT` so the OS loops sound + vibration until the user dismisses or taps the notification. Tapping still opens `AlarmActivity` (which, being in insistent mode with `skipSound=false` now — see below — takes over as the dismiss surface).
- Change from today: when insistent is on, the unlocked path passes `skipSound=true` → the OS is looping channel audio, so the activity must **not** also play, but it should still pulse and show Dismiss; dismissing cancels the notification which stops the OS loop.

**C. App in foreground (JS path)**
- `AlarmSoundModule.play()` gets an `insistent` variant: loops the MediaPlayer + starts vibration, and JS shows a full-screen "Session over" state (the existing break-challenge modal already appears for work→break; add a Dismiss affordance that calls a new `AlarmSound.stopInsistent()`).
- Simplest v1: reuse the same native mechanism — from JS call `NativeModules.AlarmSound.playInsistent(file)` and stop it from the challenge modal's **Done** button and the timer screen's Start/Reset/Skip actions.

### Behavior when OFF
Exactly today's behavior. No regressions.

## 5. Architecture & data flow

The `insistent` flag must travel from Settings → JS hook → native intent extras, because `AlarmService` runs when the JS engine may be frozen and **cannot ask JS for settings**.

```
Settings (AsyncStorage: insistentAlarm)
  → usePomodoro (settingsRef)
    → AlarmSound.scheduleAlarm(triggerAtMs, title, body, sound, insistent)   // new param
      → PendingIntent extra "insistent" → AlarmService
        → notification: FLAG_INSISTENT (unlocked) / FSI channel (locked)
        → AlarmActivity intent extras: insistent, isBreak
          → looping MediaPlayer + Vibrator + background pulse + Dismiss button
```

Key principle: **the flag is snapshotted at schedule time**, not read at fire time. Toggling the setting mid-session takes effect on the next schedule (rescheduling happens on every start/seek anyway, so in practice it applies almost immediately).

## 6. Detailed changes, file by file

### `src/types/index.ts`
- `Settings` + `insistentAlarm: boolean`; `DEFAULT_SETTINGS.insistentAlarm = false`.
- (`loadSettings` already spreads over `DEFAULT_SETTINGS`, so existing installs migrate for free.)

### `src/screens/SettingsScreen.tsx`
- New `Switch` row in Behaviour, wired via existing `persist({ insistentAlarm: v })`.

### `src/hooks/usePomodoro.ts`
- `scheduleEndNotification(...)` gains `insistent: boolean`; pass `settingsRef.current.insistentAlarm` from the two call sites (isRunning effect, `seekTo`).
- Foreground path in `advanceSession`: when insistent and `shouldNotify`, call `AlarmSound.playInsistent(file)` instead of `play(file)`; expose a `stopAlarm()` from the hook (wraps `AlarmSound.stopInsistent()`) so the UI can end it.
- `pause`/`reset`/`skip`/`start` call `stopInsistent()` defensively (no-op when nothing is looping).

### `src/screens/TimerScreen.tsx`
- Challenge modal **Done** / **Try a different one** → also `stopAlarm()`. When there is no challenge to show (break→work end, or empty challenge list) the session-end UI is just the timer screen — the insistent loop is stopped by any control interaction, plus JS auto-stops it after `INSISTENT_TIMEOUT_MS` to mirror native.

### `plugins/android/AlarmSoundModule.kt`
- `scheduleAlarm(..., insistent: Boolean)` — add extra to the service intent.
- New `@ReactMethod playInsistent(fileName: String)`: like `play()` but `isLooping = true` + starts `Vibrator` with a repeating waveform.
- New `@ReactMethod stopInsistent()`: stops/releases player, cancels vibrator. Also called from `cancelAlarm()`.
- Extract the vibration waveform + timeout constants to `companion object` so `AlarmActivity` shares them.

### `plugins/android/AlarmService.kt`
- Read `insistent` extra; forward to `AlarmActivity` intent.
- **Unlocked path:** when insistent, post on the new insistent channel (below) and set `builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }`. Pass `skipSound=true` still (OS loop owns audio).
- **New channels** `pomo-work-5-insistent` / `pomo-break-5-insistent`: same as work/break channels but with vibration pattern set. Needed because `FLAG_INSISTENT` loops *channel* sound/vibration, and existing channel settings are frozen (per the project's channel-versioning rule). Create lazily in `AlarmService` like `FSI_CHANNEL_ID`. Mirror the ID constants in `App.tsx` comment (or land the config-plugin channel-ID injection from `PROJECT_REVIEW.md` §4 first).
- **Locked path:** unchanged channel (FSI stays silent); the activity does the escalation.

### `plugins/android/AlarmActivity.kt`
- Read `insistent` extra. When true:
  - `player.isLooping = true`; do **not** auto-dismiss on completion (completion never fires when looping) and skip the 5 s fallback.
  - Start repeating vibration (`VibratorManager` on API 31+, legacy `Vibrator` below).
  - Background pulse: `ValueAnimator.ofArgb(dark, sessionColor)` with `REVERSE` repeat, ~650 ms per leg.
  - Add a Dismiss button (`TextView` pill, matches existing programmatic-UI style) → `stopEscalation()` then existing `dismissAlarm()`.
  - `Handler.postDelayed(::timeoutStop, INSISTENT_TIMEOUT_MS)` — on timeout stop sound/vibration/animation but **keep the activity + notification** so the user still sees what happened.
  - `onDestroy`/`onPause`: stop vibrator + animator unconditionally (user may leave via back/home).
- When false: exactly current behavior.

### `App.tsx`
- No new channels needed on the JS side (insistent channels are service-created), but bump nothing — existing channels untouched, so **no `-4` → `-5` migration is forced** by this feature.

## 7. Edge cases & safety

| Case | Handling |
|---|---|
| User toggles setting mid-running-session | Applied on next `scheduleAlarm` (start/seek/next session). Acceptable; document in setting description if desired. |
| Insistent alarm fires during a phone call | `USAGE_ALARM` audio is ducked/routed by the OS; vibration still runs. Acceptable. |
| Activity killed by OEM while looping | `onDestroy` stops vibrator/player; vibrator also has the 60 s repeating-waveform cap via explicit cancel in timeout path. Worst case: notification remains, sound dies with process. |
| Battery / annoyance | Hard 60 s cap on every mechanism, in both native paths and JS. One constant, shared. |
| Double sound regressions | The existing invariants hold: exactly one audio owner per path — activity (locked), channel loop (unlocked, `skipSound=true`), JS/`playInsistent` (foreground, `alarmActivityShowing` guard unchanged). |
| `FLAG_INSISTENT` OEM quirks | Some OEMs cap loop duration — fine, that's within the 60 s budget anyway. |
| Back-gesture escape from `AlarmActivity` | Treat as dismiss (stop everything, cancel notification) — never leave sound looping headless. |

## 8. Rollout plan

1. **PR 1 (prereq, small):** fix `alarmActivityShowing` stuck-flag + wakelock leak from `PROJECT_REVIEW.md` §1.1–1.2 — insistent mode makes a stuck flag much worse (a 60 s loop that can't be re-triggered silently).
2. **PR 2 (feature):** setting + JS plumbing + native insistent mode (sound loop, vibration, pulse, Dismiss, timeout, `FLAG_INSISTENT` channel pair).
3. **PR 3 (v2, optional):** torch strobe sub-toggle (`CameraManager.setTorchMode`, 2 Hz, stops with everything else); volume ramp-up.

**Manual test matrix** (physical device, per `POSSIBLE_TEST_SETUP.md` ADB setup): toggle {on, off} × path {locked, unlocked-background, foreground} × dismissal {tap Dismiss, swipe notification, back gesture, wait for timeout} — 24 cases, the off-column being regression checks against current behavior.

## 9. Open questions (defaults chosen, revisit if wrong)

- **Timeout duration:** 60 s chosen. Real alarm-clock apps use 1–10 min; for a pomodoro 60 s feels proportionate.
- **Does insistent apply to break-end too, or only work-end?** v1: both (single toggle). If breaks feel over-alarmed, split into two toggles later — the plumbing (per-schedule flag) already supports it.
- **Vibration pattern:** proposed `[0, 400, 300, 400, 1200]` repeating — two pulses, pause. Tune on device.
