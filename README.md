# AquaGuard

Smart residential water tank monitoring and automatic filling, built on an ESP32-S3.

A waterproof ultrasonic sensor on the roof measures the tank level. The
controller opens a normally closed inlet valve at 35 % and closes it at 90 %.
A float switch and an emergency stop cut valve power through a relay on their
own, without any software. You watch and manage the tank from a phone app,
from anywhere.

## Current versions

| Program | Version | Where it lives | Status |
|---|---|---|---|
| Firmware (ESP32-S3) | **0.6.0** | [`firmware/`](firmware/) | Bench-test build runs on a bare ESP32-S3 N16R8 and reports to Firebase; 60 logic tests pass; not yet run with the sensor, valve or interlock wired |
| Phone app (Android, iOS, web) | **0.7.0** | [`mobile/`](mobile/) | Type-checks; 26 tests pass; shows live data from the bench unit; filling times and PIN checked in demo mode only; unit list checked in a browser with one real unit |
| Data schema (unit ↔ cloud ↔ app) | **3** | [`docs/firebase-setup.md`](docs/firebase-setup.md) | A filling time per day and the low-level fill |
| Project guide | 13 Nov 2026 | [`documents/`](documents/) | Hardware design, 21 pages |
| Components and wiring sheet | 16 Nov 2026 | [PDF](documents/AquaGuard_Components_and_Wiring.pdf) | Parts list and wiring diagram, 2 pages, taken from the project guide |
| Users and sharing guide | 16 Nov 2026 | [PDF](documents/AquaGuard_Users_and_Sharing_Guide.pdf) | Adding people and more units, 4 pages; the cases in it are not yet tried |

Version numbers are kept in one file, [`versions.json`](versions.json), and
copied into each program by `node scripts/sync-versions.mjs`. Every change is
listed in [`CHANGELOG.md`](CHANGELOG.md).

## What is in this repository

```
documents/   Project guide (.docx), 2-page components and wiring sheet, users and sharing guide (PDF)
firmware/    ESP32-S3 firmware (PlatformIO, Arduino C++) and the local web dashboard
mobile/      Phone app (Expo / React Native, TypeScript)
firebase/    Database access rules and their test
docs/        Remote access setup guide
scripts/     Version sync
```

## How the parts connect

```
Roof: JSN-SR04T sensor ──RS485──▶ ESP32-S3 controller ──▶ valve (through relay K1)
                                      │   ▲
            float + emergency stop ───┘   │  hardware interlock, no software involved
                                      │
              home Wi-Fi ─────────────┤
                                      ├──▶ local dashboard  http://<unit-ip>/   (works with no internet)
                                      └──▶ Firebase (outbound HTTPS only) ◀──▶ phone app, anywhere
```

### Remote access at no cost

The recommended and implemented method is **Firebase Realtime Database on the
free Spark plan** (no payment card):

- The unit only makes outbound connections, so there is no port forwarding and
  the controller is never exposed to the internet.
- The app gets live updates, sign-in and per-unit access rules.
- One codebase runs on Android, iOS and the web. It runs in the free Expo Go
  app, so no paid developer account is needed to use it.
- If the internet is down, the unit keeps working and the local dashboard still loads.

Alternatives considered and the reasons are in
[`docs/firebase-setup.md`](docs/firebase-setup.md#why-firebase).

## Getting started

1. **Buy and wire** the hardware using the
   [project guide](documents/AquaGuard_ESP32_S3_Complete_Project_and_Sri_Lanka_Buying_Guide.docx).
2. **Flash the firmware**: [`firmware/README.md`](firmware/README.md).

   ```bash
   cd firmware
   pio test -e native                  # logic tests, no board needed
   pio run -e aquaguard_s3 -t upload   # build and flash
   ```

3. **First start**: join the unit's setup Wi-Fi, set a password, enter your
   Wi-Fi, calibrate, mark it commissioned, acknowledge to arm.
4. **Remote access**: follow [`docs/firebase-setup.md`](docs/firebase-setup.md) (about 15 minutes, once).
5. **Phone app**: [`mobile/README.md`](mobile/README.md).

   ```bash
   cd mobile
   npm install
   cp .env.example .env    # paste your Firebase web config
   npx expo start          # scan the QR code with Expo Go
   ```

## Safety

- The firmware has **not been tested on hardware yet**. Commission it on a
  supervised low-voltage test rig, with a 12 V lamp in place of the valve,
  following guide sections 16 and 17, before it controls water.
- Overfill protection does not rely on software: the float loop and emergency
  stop interrupt valve power through relay K1. Keep the independent mechanical
  float valve and a clear overflow path.
- The app and dashboard show the valve **command**. Without a flow sensor
  nothing can prove the valve physically closed.
- Remote control is off by default. When enabled at the unit, remote requests
  pass the same checks as local ones; an emergency stop can only be
  acknowledged at the unit, and calibration can only be changed there.
- A permanent house installation needs a valve rated for your water pressure
  and potable water, protected outdoor wiring, and qualified installers, as
  the guide describes.

## Known gaps

- Hardware validation of the firmware (sensor frames, interlocks, valve timing).
- The Firebase rules test (`firebase/rules.test.mjs`) has not been run; it
  needs Java for the local emulator.
- A bare board on bench-test firmware 0.6.0 reports to the live Firebase
  project and the app shows its live data. No multi-user case has been tried.
- Filling times (one per day), the low-level fill and the settings PIN are
  tested as logic (firmware and app tests) and in the app's demo. Saving
  them from the app to a real unit has not been confirmed, and the unit has
  not been watched through a real window opening and closing or a real
  low-level fill.
- The database rules in `firebase/database.rules.json` were published to the
  live project on 19 November 2026. The unit still reports and the app still
  shows its data under them. A viewer saving with the PIN, and an owner
  sending a request, have not been tried under the new rules.
- A low-level fill opens the valve outside the filling times. If the supply
  is off it gets no water: the valve stays open for `noProgressStopMinutes`
  (20 by default), closes, and tries again after `retryMinutes` (30), for as
  long as the tank stays that low.
- The settings PIN is 4 digits by default and shared: it limits who can
  change settings among people who already have access, nothing more.
- On 19 November 2026 the bench board came up with its saved settings
  erased after a reflash; the cause was not found. They were restored over
  USB and survived the next flash.
- The app's list of units is kept on each phone, not in the account, so a
  new phone starts empty. Switching was checked in a browser between the
  bench unit and an ID with no unit behind it; a second real unit has not
  been tried.
- Power-saving sleep and firmware update over Wi-Fi have not been exercised
  on a board.
- Water-board (NWSDB) outage notices are researched, not built. The schedule
  has one window per day of the week; no per-date exceptions yet.
- Root certificates for Firebase are embedded in the firmware; the earliest
  expires in January 2028 and they will need refreshing in a firmware update
  before then.
- No push notifications yet: the app shows faults when opened.

## Project guide

[Download the complete project and Sri Lanka buying guide](documents/AquaGuard_ESP32_S3_Complete_Project_and_Sri_Lanka_Buying_Guide.docx)
(21 pages): component quantities and Sri Lankan supplier links, GPIO
assignments, RS485 and power wiring, the interlock and valve driver circuits,
calibration, control behaviour, commissioning and fault tests. Supplier
information and reference prices were reviewed on 13 November 2026; confirm
stock and delivered part specifications before buying.

## See the app without a phone

```bash
cd mobile
npm install
npx expo start --web
```

A browser tab opens. Choose **Open the demo with sample data** to explore every
tab with a simulated tank: no Firebase project, unit or phone needed. Narrow
the browser window (or use the browser's device toolbar) for a phone-sized
view. Details and emulator options are in [`mobile/README.md`](mobile/README.md).

## Latest update

**19 November 2026: a filling time for each day, and a low-level fill.**
Firmware 0.6.0 and app 0.7.0 give every day of the week its own filling time
(or none), set from a week view on the app's Control tab. With the filling
times on, a tank that drops to 15 % (adjustable) now fills straight away
instead of waiting. Data schema is 3, and the updated database rules were
published to the live Firebase project. Details in
[`CHANGELOG.md`](CHANGELOG.md).
