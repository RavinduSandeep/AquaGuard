# Changelog

Each program has its own version number (see `versions.json`). Versions follow
`MAJOR.MINOR.PATCH`: PATCH for fixes, MINOR for new features, MAJOR for
changes that break compatibility. The data schema number goes up whenever the
shape of the data shared by the unit, Firebase and the app changes.

## 2026-11-13 (bench test)

### Firmware 0.3.0

- New build `aquaguard_s3_sim` for a bare board: a simulated tank and healthy
  inputs feed the real parser, validation and control logic; the valve output
  is never driven; status carries `simulated: true`. The normal build is
  unchanged in behaviour.
- The bench-test build was flashed to a bare ESP32-S3 and starts.

### Phone app 0.4.0

- Shows a warning on the Tank tab when the unit runs bench-test firmware.

## 2026-11-13 (power saving)

### Firmware 0.2.0

- Optional power saving (off by default, switched on only at the unit): deep
  sleep for 1 to 60 minutes between checks while armed, idle, healthy and at
  least 5 % above the start threshold. Wakes on the timer or the ACK button;
  stays awake while the dashboard is in use so firmware can be updated.
- The valve request, buzzer and pixel lines are held at their off levels
  during sleep.
- A wake from such a sleep re-arms only if the unit went to sleep armed and
  everything is healthy; it never clears a latched fault. Any other restart
  still boots disarmed. Three new logic tests (41 in total).
- Status reports the sleep period and the next wake time.
- Startup log moved to the native USB port.
- Flashed to a bare ESP32-S3 DevKitC-1 N16R8: it boots, detects 16 MB flash
  and 8 MB PSRAM, and starts its setup access point. Nothing that needs the
  sensor, valve, interlock, display or a sleep cycle has been exercised.

### Phone app 0.3.0

- A unit in power saving is shown as asleep with the time to its next report,
  and as offline if it misses that. The level is still labelled as the last
  report. 14 tests.

### Project

- Firebase project created and configured (rules, e-mail sign-in, web app).

## 2026-11-13 (later)

### Phone app 0.2.0

- Demo mode: "Open the demo with sample data" on the sign-in and setup
  screens. A simulated tank (seven days of history, live level, working
  controls, settings and logbook) runs entirely inside the app, so it can be
  viewed in a browser with no phone, Firebase project or unit.
- The simulation is simplified and runs faster than real life. It is not the
  firmware's control logic.

## 2026-11-13

### Firmware 0.1.0

First implementation, following the project guide.

- Control core with a single authority for the valve request (SafetyManager):
  35 % / 90 % hysteresis, disarmed at every boot, latched faults for emergency
  stop, float loop, K1 feedback, sensor, fill timeout and no progress.
- JSN-SR04T V3 automatic UART parser with resynchronisation, 7-sample median,
  range and rate validation, 2 s stale timeout, calibration capture from 21
  settled readings.
- 20 ms control task with a 3 s watchdog; valve request held LOW from the first
  line of `setup()`.
- OLED, eight-pixel WS2812 bar, buzzer patterns, ACK button.
- Local dashboard and REST/SSE API with password sign-in, settings,
  calibration, diagnostics, event log and authenticated firmware upload.
- Protected setup access point for first-time configuration.
- Optional Firebase sync: status, 5-minute history, events, and remote
  requests that pass through the same safety checks.
- Settings stored in NVS with a CRC; emergency-stop, float and fill-timeout
  latches survive a power cycle.
- 38 native unit tests. Builds for ESP32-S3 (1.5 MB of the 6.5 MB app slot).
- Not yet tested on hardware.

### Phone app 0.1.0

First implementation (Expo / React Native, Android + iOS + web).

- Sign-in, device pairing by Device ID.
- Tank, History (level chart with fill periods, table view, events), Control,
  Settings (data entry), Logbook (maintenance entries and installation
  record), About (versions).
- 13 unit tests for the app logic.
- Not yet run against a live Firebase project.

### Data schema 1

- First definition of `/devices/<deviceId>/…` in Firebase and of the status
  JSON shared by the local API, Firebase and the app.

### Project

- Firebase database rules and an emulator test for them (test not yet run).
- `versions.json` and `scripts/sync-versions.mjs` as the single source of
  version numbers.
- Documentation: root README, firmware and app READMEs, remote access guide.

### Earlier the same day

- Project guide and initial README added.
