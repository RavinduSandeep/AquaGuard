# AquaGuard firmware

Arduino C++ firmware for the **ESP32-S3 DevKitC-1 N16R8**, built with PlatformIO.
It implements the control behaviour, pin map, sensor protocol and API described
in the [project guide](../documents/AquaGuard_ESP32_S3_Complete_Project_and_Sri_Lanka_Buying_Guide.docx)
(sections 6, 12, 13, 14 and 15).

Version: see [`../versions.json`](../versions.json) (`firmware`). The running
version is shown on the OLED at start-up, on the local dashboard, in
`/api/status` (`fw`) and in the phone app's About tab.

> **Status: boots on a bare board, not yet run with the hardware wired.** The
> control logic passes 41 automated tests on a PC. The firmware was flashed to
> an ESP32-S3 DevKitC-1 N16R8 with nothing connected: it starts, reports
> 16 MB flash and 8 MB PSRAM, and brings up its setup Wi-Fi. It has not been
> tested with the real sensor, relay, float, emergency stop or valve. Follow guide section 16: keep the 12 V test
> lamp in place of the valve until boot, stale-data and interlock checks pass.

## Build, test, flash

Install [PlatformIO](https://platformio.org/install) (VS Code extension, or `pip install platformio`).

```bash
cd firmware
pio test -e native               # 41 logic tests on your computer, no board needed
pio run -e aquaguard_s3          # compile
pio run -e aquaguard_s3 -t upload    # flash over USB
pio device monitor               # startup log at 115200 baud
```

Use the board's native USB port (marked **USB**): it takes uploads and carries
the startup log. A new board, or one running other firmware, may not accept
the first upload on its own. Put it in download mode by hand: hold **BOOT**,
press and release **RESET**, then release **BOOT**. After AquaGuard is
installed, later uploads over that port need no buttons.

The first build downloads the toolchain (about 1 GB). Toolchain and library
versions are pinned in `platformio.ini`; keep them fixed for a commissioned
unit and re-test after changing any of them.

At boot the serial log prints the firmware version, detected flash and PSRAM
size (expect 16 MB and about 8 MB), the reset reason and the Device ID.

Later updates can be uploaded from the local dashboard (**Firmware update**)
using `.pio/build/aquaguard_s3/firmware.bin`. The unit disarms and closes the
valve before accepting the file and restarts disarmed. The flash holds two
firmware slots, so an upload that fails part-way leaves the running version
in place.

## Bench-test build (bare board, nothing wired)

```bash
pio run -e aquaguard_s3_sim -t upload
```

This separate build lets you try the dashboard, Firebase and the phone app
with only the ESP32-S3 on a USB cable. A pretend tank (starts at 60 %, drains
in about 18 minutes, fills in about 3) sends sensor frames through the real
parser, validation and control logic; the float, emergency stop and K1 inputs
read healthy; and **the valve output is never driven**. The dashboard and the
app show a "bench-test firmware" warning, and `status.simulated` is `true`.

You still set it up like a real unit: Wi-Fi, mark it commissioned in
Settings, then **Acknowledge** on the dashboard to arm (there is no ACK
button on a bare board). **Never install this build on a wired unit**: it
ignores the real safety inputs. Flash `aquaguard_s3` before wiring anything.

## Power saving (optional, off by default)

**Network and remote access → Power saving** on the local dashboard makes the
unit deep sleep between checks. It can only be switched on at the unit.

- It sleeps only when armed, in AUTO, idle, with no fault or warning, a valid
  level at least 5 % above the start threshold, and nobody using the dashboard.
- It wakes after the set time (1 to 60 minutes, default 10), stays awake for
  at least 90 seconds to measure and report, and sleeps again if still idle.
- **ACK wakes it at once** and keeps it awake for 5 minutes; an open dashboard
  keeps it awake for as long as it is open. Do this before a firmware update.
- While asleep it does not measure, fill, show anything, or answer the
  dashboard or the phone app. A fill can therefore start up to one sleep
  period late, and a request from the app is not acted on.
- The valve request is held LOW during sleep. The float switch and emergency
  stop still cut valve power through relay K1 without the processor.
- The saving is small on this hardware (the processor is a fraction of a watt
  next to the 12 V supply, relay, sensor and RS485 parts), so leave it off
  unless you have a reason such as battery backup.

## First start

1. Power the board. With no Wi-Fi stored it starts a setup access point
   `AquaGuard-xxxxxx`. The password is unique to the unit and shown on the OLED
   (`AP pw:`) and the serial log.
2. Join it and open `http://192.168.4.1`.
3. Choose an administrator password (first-time setup), sign in.
4. Enter your Wi-Fi under **Network and remote access**, save. The unit restarts
   and shows its IP address on the OLED.
5. Calibrate (guide section 11) with the service valve isolated: capture the
   EMPTY and FULL references, set the usable capacity, then tick
   `commissioned` in Settings.
6. Press **Acknowledge / arm** (or the ACK button). Automatic filling starts
   only after this, with every check healthy.

To get back to the setup access point later, hold the ACK button while powering up.

## Behaviour summary

| Condition | Result |
|---|---|
| Boot, reset, firmware update | Valve request LOW first; unit stays DISARMED until acknowledged |
| Wake from a power-saving sleep | Valve request LOW first; re-arms only if it went to sleep armed, no fault is latched and every input and the level are healthy within 20 s; otherwise DISARMED |
| Not commissioned, or stored settings corrupt | Cannot arm; valve stays closed |
| AUTO and level ≤ 35 % | Opens, if armed and every input is healthy |
| Filling and level ≥ 90 % | Closes; stays closed until 35 % again |
| Emergency stop or its monitor wire open | Closes, latches EMERGENCY_STOP; needs release and a local acknowledge |
| Float high or loop open | Closes, latches; needs 30 healthy seconds and an acknowledge |
| K1 feedback disagrees with the loops for 0.5 s | Closes, latches SYSTEM_FAULT |
| No trusted reading for 2 s | Closes (SENSOR_STALE). Missing data is never read as an empty tank |
| 10 invalid measurement opportunities | Latches SENSOR_FAULT |
| Sudden level jump | Rejected; accepted as a new baseline only after 6 consistent readings |
| Fill longer than 120 min | Closes, latches FILL_TIMEOUT |
| No 1 % rise for 10 min / 20 min | Warning / close and latch (or timed retry if enabled) |
| MANUAL open | Time limited (5 min), same protections, stops at the stop level |
| CLOSE request | Always accepted; AUTO drops to MANUAL so it does not reopen |
| Wi-Fi or internet lost | Control continues unchanged |
| Control task stalls for 3 s | Watchdog reset; boots disarmed with the valve closed |

Emergency-stop, float and fill-timeout latches are stored in flash, so a power
cycle does not clear them.

The numbers above are the defaults from guide section 13 and are editable in Settings.

## Structure

| Path | Responsibility |
|---|---|
| `include/pins.h` | Central GPIO map (guide section 6) |
| `include/version.h` | Generated from `../versions.json`; do not edit |
| `include/ca_certs.h` | Google root certificates for TLS to Firebase |
| `lib/aquaguard_core/` | Hardware-independent logic, covered by the native tests |
| `  ag_config` | Settings, defaults, validation, level maths |
| `  ag_sensor` | JSN-SR04T V3 frame parser, median filter, validation pipeline |
| `  ag_safety` | SafetyManager: the single authority for the valve request |
| `src/control.cpp` | 20 ms control task: inputs, UART, pipeline, safety tick, valve pin |
| `src/app.cpp` | Shared state, request functions, status/diagnostic JSON, event log |
| `src/storage.cpp` | Settings (JSON + CRC) and network settings in NVS; password hashing |
| `src/ui.cpp` | OLED, eight WS2812 pixels, buzzer patterns, ACK button |
| `src/webapi.cpp` | Wi-Fi, setup access point, REST + SSE API, OTA upload |
| `src/power.cpp` | Optional deep sleep between checks, and re-arming after such a sleep |
| `src/cloud.cpp` | Optional Firebase sync task (status, history, events, commands) |
| `web/index.html` | Local dashboard, embedded in the firmware image |
| `test/test_core/` | Parser vectors, calibration maths, filters, state transitions, interlock denial, timers |

Only `control.cpp` writes the valve GPIO, and only with the value
`SafetyManager::valveRequest()` returns. The web API, the cloud task and the
button all submit requests instead.

## Local API

Open `http://<unit-ip>/` for the dashboard. Endpoints (guide section 15):

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/status` | no | Level, mode, valve command, interlocks, faults |
| `GET /api/live` | no | Server-sent events, one status per second |
| `GET /api/config` | no | Current settings |
| `GET /api/events` | no | Recent events (RAM log, 64 entries) |
| `GET /api/diag` | no | Sample window, UART counters, heap, reset reason |
| `POST /api/setup` | first time only | Set the administrator password |
| `POST /api/login` | password | Returns a session token |
| `POST /api/config` | token | Change settings (validated as a whole) |
| `POST /api/mode` | token | `{"mode":"AUTO"｜"MANUAL"｜"MAINTENANCE"}` |
| `POST /api/valve/open`, `/api/valve/close` | token | Manual requests |
| `POST /api/fault/ack` | token | Acknowledge and arm |
| `POST /api/buzzer/mute` | token | Mute (does not clear faults) |
| `POST /api/calibrate/full`, `/empty` | token | Capture the median of 21 settled readings |
| `GET/POST /api/network` | token | Wi-Fi and Firebase settings (secrets are write-only) |
| `POST /api/ota` | token | Firmware upload |

Send the token in the `X-Auth-Token` header. Refused requests return
`{"ok":false,"reason":"E_STOP_ACTIVE"}` and similar. Read-only endpoints are
open to anyone on your home network; keep the unit off guest networks.

## Differences from the guide

- **Dashboard files are embedded in the firmware** instead of stored in
  LittleFS, so one upload installs everything. The partition table still
  reserves a filesystem partition.
- **Remote access through Firebase and a phone app were added.** The guide
  lists a native app and cloud as not required for V1; they are optional here
  and local operation never depends on them. See [`../docs/firebase-setup.md`](../docs/firebase-setup.md).
- **`commissioned` flag added.** Arming is refused until calibration has been
  confirmed, because the default distances are only examples.
- **Manual open stops at the normal stop level** (90 %), not only at the
  high-high backstop.
- **`restartArmed` is fixed to false** (always acknowledge after a restart) and
  `valveActiveHigh` is a constant in `pins.h`, matching the specified hardware.
- **Optional power-saving sleep added.** The guide has no sleep mode and says
  every restart boots disarmed. A wake from a sleep the firmware started
  itself while armed and idle is the one exception: it re-arms without an
  acknowledgement, and only when nothing is latched and all inputs are
  healthy. The option is off by default.
- **Startup log on the native USB port** (`ARDUINO_USB_CDC_ON_BOOT`), not UART0.
- **No optional smoothing stage** after the median and rate check.

## Before trusting it with water

Work through guide sections 16 and 17 and record the results. In particular,
verify on the bench: the frame format of your actual sensor (`/api/diag` shows
raw bytes and counters), no valve pulse on power-up or reset, each interlock
with the MCU disconnected, and the 2 second stale-data close.
