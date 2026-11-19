# AquaGuard phone app

One codebase for **Android, iOS and web** (Expo / React Native, TypeScript).
It shows the tank from anywhere through Firebase and is where you enter data.

Version: see [`../versions.json`](../versions.json) (`mobile`). The app's About
tab shows the app version, the unit's firmware version and the data schema of both.

> **Status:** type-checks and passes its 21 unit tests. The screens were
> checked in a browser with sample data, and the Tank and Control tabs were
> seen showing live data from a bench-test unit. Saving settings or filling
> times to a real unit has not been confirmed yet.

## Tabs

| Tab | What it does |
|---|---|
| **Tank** | Level, a live diagram of the installation, **Valve on / off**, estimated litres, state banner, float / emergency stop / K1, reading age |
| **History** | Level chart for 24 hours, 3 days or 7 days with fill periods shaded, table view, event list |
| **Control** | Close, **filling times**, mode, time-limited manual open, acknowledge, mute. The unit decides and its refusal reason is shown |
| **Settings** | Data entry for tank name, capacity, thresholds, fill supervision, indication. Calibration is read-only here. Saving asks for the settings PIN |
| **Logbook** | Data entry for monthly and quarterly checks, notes, and the installation record |
| **About** | Versions, connection state, sign out |

### The diagram and the valve buttons

The Tank tab opens with a picture of the installation: water line, valve,
tank, the ultrasonic level sensor, the float switch and the controller. The
tank shows the level and the start, stop and low marks. While the valve is
commanded open the pipe is drawn with moving water; this follows the command,
not real flow. Tap a part (or its name under the picture) to read what it is
and what it reports now.

**Valve on** and **Valve off** work in any mode and outside the filling
times, and leave the mode and the filling times as they are. On is the unit's
time-limited manual fill (the "Manual open time" on the Settings tab, 1 to 15
minutes): it also stops at the stop level and every interlock stays active.
Off in Auto pauses automatic filling for the unit's retry time (30 minutes by
default) or until the next filling time starts. Only the owner's requests are
accepted. This needs firmware 0.7.0 or later.

### Filling times and the settings PIN

On the Control tab, switch on **Fill only when the supply is on**. The week
is listed Monday to Sunday with a bar for each day; tap a day to enter its
start time the way an alarm clock does (hour, minute, AM or PM), or switch
that day off. **Valve on time** is one length for every day (typed in hours
and minutes, or picked from 10 min to 2 h): each filling time ends that long
after its start. **Open the valve when each filling time starts** makes the
unit fill at the start time even if the tank is not low (firmware 0.7.0 or
later); with it off, the valve opens inside a filling time only when the
level is at or below the start point. **Every day**, **Mon to Fri** and
**Sat and Sun** copy the selected day's setting to other days.

**Fill at any time when the tank is very low** (15 % by default, in steps of
5 %) lets the unit fill outside the filling times when the level drops that
far. The Tank tab shows the low level as a third mark on the tank. This needs
firmware 0.6.0 or later.

Saving filling times or settings asks for the unit's **settings PIN**
(default 4211; the owner changes it on the unit's own page). Once the unit
has accepted the PIN it is not asked for again until the app is closed.
Anyone who is a member of the unit and knows the PIN can save, including a
member with the `viewer` role.

Sign in with the **owner** account, not the unit's device account: the
device account can see the tank but every request it sends is refused.

The sign-in screen also has **Open the demo with sample data** (demo PIN 4211).

### More than one unit

Tap the tank name at the top to open **Your units**: switch to another unit,
add one by its Device ID, or remove one from this phone. The list is stored
on the phone only (up to 12 units) and does not grant access: an account
still has to be a member of a unit to see it. Each unit has its own settings,
filling times and settings PIN.

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
