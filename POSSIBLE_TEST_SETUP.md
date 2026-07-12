# Possible E2E Test Setup (Maestro + ADB)

## Overview

Maestro is the recommended E2E framework for Expo/React Native. It uses a declarative
YAML syntax to drive a real Android device via ADB. No emulator is required — a physical
device works fine.

## Prerequisites

### Windows side
- Enable **USB debugging** on the Android device (Settings → Developer Options)
- Plug device into Windows USB
- Confirm Windows ADB sees it: run `adb devices` in a Windows terminal (PowerShell/CMD)
- Windows ADB server starts automatically on port 5037

### WSL2 side
- Install ADB in WSL2: `sudo apt install adb`
- Point WSL2 ADB at the Windows ADB server:
  ```bash
  adb -H host.docker.internal -P 5037 devices
  # Should list your device
  ```
- Optional: add to `~/.bashrc` or `~/.config/fish/config.fish`:
  ```bash
  export ADB_SERVER_SOCKET=tcp:host.docker.internal:5037
  ```
  After this, plain `adb devices` works from WSL2.

### Install Maestro
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
# Adds ~/.maestro/bin to PATH — restart shell or source profile
maestro --version
```

## Running tests

1. Build the APK: `bash build-pomo.sh`
2. Install it on the device:
   ```bash
   adb install build-<timestamp>.apk
   ```
3. Run a flow:
   ```bash
   maestro test e2e/timer-pause-resume.yaml
   ```

## Example flow — pause/resume notification button

```yaml
# e2e/timer-pause-resume.yaml
appId: com.kusm.pomo
---
- launchApp
- tapOn: "Start"
- assertVisible: "25:00"        # timer running
- waitForAnimationToEnd
- tapOn:
    id: "cd_text"               # notification countdown text
# The notification action button tap requires swiping down first:
- swipe:
    direction: DOWN
    startRelative: "50%, 5%"
    endRelative: "50%, 40%"
- tapOn: "Pause"                # notification action button
- assertVisible: "Resume"       # button should flip to Resume
- tapOn: "Resume"
- assertVisible: "Pause"        # back to running state
```

> **Note:** Tapping notification action buttons requires the notification shade to be
> open. Maestro's `swipe` gesture opens it, then `tapOn` targets the button label.

## What E2E tests can verify that unit tests cannot

- Pause/Resume notification button actually appearing and being tappable
- Countdown timer updating live in the notification
- AlarmActivity appearing over the lock screen when timer ends
- Sound playing through alarm volume stream
- Full session flow (work → break → work) including auto-start

## Alternative: EAS Workflows (no local setup)

If the ADB bridge is too painful, EAS can run Maestro flows in the cloud after each build:
- See: https://docs.expo.dev/eas/workflows/examples/e2e-tests/
- Add a `.eas/workflows/e2e.yml` that builds the APK then runs `maestro test`
- Costs EAS build credits but requires zero local infrastructure
