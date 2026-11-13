# AquaGuard phone app

One codebase for **Android, iOS and web** (Expo / React Native, TypeScript).
It shows the tank from anywhere through Firebase and is where you enter data.

Version: see [`../versions.json`](../versions.json) (`mobile`). The app's About
tab shows the app version, the unit's firmware version and the data schema of both.

> **Status:** type-checks, passes its 14 unit tests and bundles for Android, iOS
> and web. The screens were checked in a browser with sample data. It has not
> yet been run against a real Firebase project or a real unit.

## Tabs

| Tab | What it does |
|---|---|
| **Tank** | Level, estimated litres, state banner, valve command, float / emergency stop / K1, reading age |
| **History** | Level chart for 24 hours, 3 days or 7 days with fill periods shaded, table view, event list |
| **Control** | Close, mode, time-limited manual open, acknowledge, mute. The unit decides and its refusal reason is shown |
| **Settings** | Data entry for tank name, capacity, thresholds, fill supervision, indication. Calibration is read-only here |
| **Logbook** | Data entry for monthly and quarterly checks, notes, and the installation record |
| **About** | Versions, connection state, sign out |

The sign-in screen also has **Open the demo with sample data**.

When the unit is offline or its reading is stale, the level is shown as
unknown with the last trusted value labelled as such.

## View it without a phone

```bash
cd mobile
npm install
npx expo start --web
```

A browser tab opens. Choose **Open the demo with sample data**. The demo is a
simulated tank inside the app: it needs no Firebase project and no unit, and
nothing is sent anywhere. It runs faster than a real tank so you can watch a
fill. For a phone-sized view, narrow the window or use the browser's device
toolbar (Chrome: View → Developer → Developer Tools, then the phone icon).

The browser shows the same screens and code as the Android and iOS apps, with
small differences in fonts and switches. To see the true native look without
a phone you need a simulator:

| Simulator | Needs | Then |
|---|---|---|
| iPhone | Full Xcode from the Mac App Store (free, about 15 GB) | `npx expo start`, press `i` |
| Android | Android Studio with a virtual device (free, about 10 GB) | `npx expo start`, press `a` |

Install Expo Go when the simulator offers it. The demo button works there too.

## Run it on your phone (free)

1. Do the one-time Firebase setup in [`../docs/firebase-setup.md`](../docs/firebase-setup.md).
2. Install **Expo Go** from the Play Store or App Store.
3. On your computer:

   ```bash
   cd mobile
   npm install
   cp .env.example .env     # paste your Firebase web config
   npx expo start
   ```

4. Scan the QR code (Android: in Expo Go; iPhone: with the Camera app).
5. Sign in with the owner account and enter the unit's Device ID.

Expo Go needs your computer running. For an app that stays on the phone:

| Target | Free route | Notes |
|---|---|---|
| Android | `npx eas-cli build -p android --profile preview` gives an installable APK | Needs a free Expo account; EAS has a monthly free build allowance |
| iPhone | Web version + Safari **Add to Home Screen** (see the Firebase guide) | No Apple fee |
| iPhone, native | Build with Xcode on a Mac using a free Apple ID | The install expires after 7 days; a permanent install or App Store release needs the paid Apple Developer Program |
| Any browser | `npx expo start --web` | |

## Develop

```bash
npm run typecheck    # TypeScript
npm test             # unit tests (src/logic.test.ts)
npx expo-doctor      # dependency checks
```

Version numbers are generated: change `../versions.json` and run
`node ../scripts/sync-versions.mjs`. See [`AGENTS.md`](AGENTS.md) for the code layout.
