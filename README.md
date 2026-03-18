# PomoChallenger

A minimalist Pomodoro timer for Android with background alarms and break challenges. Fires a full-screen alert with sound when a session ends, even with the screen off. Includes a customizable challenge library to keep breaks active.

## Features

- Work / short break / long break sessions with configurable durations
- Full-screen alarm that fires even when the screen is locked or the app is in the background
- Sound routed through the alarm volume stream (respects your alarm volume, not media)
- Break challenges — a random challenge shown at the start of each break, drawn from a customizable library organized into groups
- Auto-start next session option
- Progress dots tracking pomodoros in the current cycle

## Installation

Download the latest APK from [Releases](https://github.com/mkusm/PomoChallenger/releases) and install it on your Android device.

On first launch, grant the **Full-screen intent** permission when prompted (Android 14+). This is required for the alarm to appear over the lock screen.

## Building from source

Requires Android SDK, NDK, and JDK 17. With those in place:

```bash
npm install
bash build-pomo.sh
```

This increments the patch version, builds a release APK via EAS local build, and outputs it to `build/`.
