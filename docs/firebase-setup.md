# Remote access setup (Firebase, free plan)

This connects the AquaGuard unit to the phone app from anywhere, at no cost.

## How it works

```
ESP32-S3 unit ──outbound HTTPS──▶ Firebase Realtime Database ◀──▶ phone app
   (home Wi-Fi)                      (Google, free Spark plan)      (anywhere)
```

- The unit only makes outbound connections. No port forwarding, no public IP,
  no always-on computer at home. The guide's rule "keep the controller off the
  public internet" still holds.
- The unit writes its status every 5 seconds and a level sample every 5
  minutes. The app reads them live.
- The app never drives the valve. It writes a request; the unit picks it up
  within about 3 seconds, runs it through the same safety checks as a local
  request, and writes back accepted or refused with the reason.
- If the internet or Firebase is down, the unit keeps filling and protecting
  the tank exactly as before. Only the remote view stops.

### Why Firebase

| Option | Cost | Why not chosen |
|---|---|---|
| **Firebase Realtime Database + Auth** | Free (Spark plan, no card) | Chosen: live updates, sign-in, access rules, works on Android/iOS/web |
| Router port forwarding to the unit | Free | Exposes the controller to the internet; the guide forbids it |
| VPN to home (Tailscale, WireGuard) | Free | Needs an always-on computer or a capable router at home |
| Blynk, Arduino Cloud | Free tiers are small | Device and data limits; less control over the app |
| Self-hosted MQTT server | VPS cost | Not free; more to maintain |

Free plan limits at the time of writing (check <https://firebase.google.com/pricing>):
1 GB stored, 10 GB downloaded per month, 100 simultaneous connections.
One unit uses well under 1 GB per month of download and a few MB of storage.
The Spark plan cannot bill you: if a limit is reached, the service pauses until
the next month.

## One-time setup (about 15 minutes)

### 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project**, name it (for example `aquaguard-home`). Google Analytics is not needed.
3. Stay on the **Spark** (free) plan.

### 2. Create the database

1. **Build → Realtime Database → Create database**.
2. Pick the location nearest you (for Sri Lanka: **Singapore, asia-southeast1**).
3. Start in **locked mode**.
4. Note the database URL shown at the top, for example
   `https://aquaguard-home-default-rtdb.asia-southeast1.firebasedatabase.app`.

### 3. Create two accounts

**Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**

Then on the **Users** tab, **Add user** twice:

| Account | Example e-mail | Used by |
|---|---|---|
| Owner | your own e-mail | You, in the phone app |
| Device | `unit@aquaguard.invalid` (any address, it is never mailed) | The ESP32 unit |

Use a long random password for the device account. Copy the **User UID** of
both accounts (shown in the Users table).

Separate accounts mean the password stored on the unit can only publish data
for that unit. It cannot send commands or read anything else.

### 4. Publish the access rules

**Realtime Database → Rules**, replace everything with the contents of
[`firebase/database.rules.json`](../firebase/database.rules.json), then **Publish**.

In short: only members of a unit can read it; only the device account writes
status, history, events and results; only the owner writes commands, the
logbook and the installation record; nobody can add members from an app.

### 5. Register the unit's members

Find the unit's **Device ID** (looks like `ag-1a2b3c`): it is shown at the top
of the unit's local dashboard and printed on the serial monitor at start-up.

**Realtime Database → Data**, hover the root, click **+** and build this
structure (or use **⋮ → Import JSON** with a file like this):

```json
{
  "devices": {
    "ag-1a2b3c": {
      "members": {
        "OWNER_USER_UID": "owner",
        "DEVICE_USER_UID": "device"
      }
    }
  }
}
```

Importing JSON at the root replaces everything in the database, so only use
import on a new, empty database. To let a family member view the tank later,
create another user and add their UID here with the value `"owner"`.

### 6. Get the web app config

**Project settings (gear icon) → General → Your apps → Web (`</>`)**, register an
app (no hosting needed) and copy the config values: `apiKey`, `authDomain`,
`databaseURL`, `projectId`, `appId`.

### 7. Configure the unit

Open the unit's local dashboard (`http://<unit-ip>/`, or `http://192.168.4.1`
on the setup access point), sign in, and under **Network and remote access** enter:

- Firebase database URL (from step 2)
- Firebase web API key (`apiKey` from step 6)
- Device account e-mail and password (from step 3)
- Tick **Send data to Firebase for the phone app**
- Tick **Allow the phone app to change mode…** only if you want remote control.
  Left unticked, the app is view-only plus Close and Mute.

Save. The unit restarts (disarmed, as after every restart). The local
`/api/status` then shows `"cloud": "ONLINE"`.

### 8. Configure the app

```bash
cd mobile
cp .env.example .env      # then paste the values from step 6
npx expo start
```

Sign in with the **owner** account and enter the Device ID. See
[`mobile/README.md`](../mobile/README.md) for installing on phones.

## Data layout

Everything for one unit lives under `/devices/<deviceId>/`:

| Path | Written by | Content |
|---|---|---|
| `members/<uid>` | Console only | `"owner"` or `"device"` |
| `status` | Unit, every 5 s | Level, mode, valve command, interlocks, faults, `updatedAt` |
| `config` | Unit, on change | Settings currently in force |
| `events/<pushId>` | Unit | Boot, fill, fault, denial, settings, acknowledge events |
| `history/<YYYYMMDD>/<HHMM>` | Unit, every 5 min | `{ p: percent, v: valve 0/1 }`, UTC, kept 30 days |
| `commands/<pushId>` | App | `{ type, ts, uid, ... }` |
| `results/<pushId>` | Unit | `{ ok, reason, type, at }` |
| `logbook/<pushId>` | App | Maintenance entries |
| `record` | App | Installation record (guide section 18) |

`status.simulated` is `true` only for the bench-test firmware build.

`status.power` is present only when power saving is on at the unit:
`{ sleepMinutes, sleepUntil }`, where `sleepUntil` (epoch seconds) is set in
the last report before a sleep. It is an optional addition, so the schema
number is unchanged.

`status.schema` carries the data schema version (currently 1). The app warns
on its About tab when the unit and the app disagree.

## Remote command safety

| Rule | Where enforced |
|---|---|
| Every request goes through SafetyManager; none writes the valve pin | Firmware |
| Requests older than 60 s are discarded, never run late | Firmware (uses Firebase's server timestamp) |
| A request is deleted before it runs, so it cannot run twice | Firmware |
| `close` and `mute` always work; everything else needs "remote control" ticked at the unit | Firmware |
| An emergency stop can only be acknowledged at the unit | Firmware |
| Calibration and "commissioned" cannot be changed remotely | Firmware |
| Only the owner account can create a command, stamped with the server time and their own UID | Database rules |
| The "remote control" switch can only be changed from the local dashboard | Firmware |

## Checking the rules

`firebase/rules.test.mjs` exercises the rules against the local Firebase
emulator (needs Java installed):

```bash
# from the repository root
npx firebase-tools emulators:exec --only database --project demo-aquaguard "node firebase/rules.test.mjs"
```

This test has not been run yet (no Java on the development machine), so run it
once, or use the **Rules Playground** in the console, before relying on the
rules. A quick manual check: signed in as the owner in the app, the Tank tab
shows data; a second account that is not in `members` gets a "not a member"
message.

## Free iPhone install without a developer account

Build the web version and host it on Firebase Hosting (also free), then use
Safari's **Share → Add to Home Screen**:

```bash
cd mobile && npx expo export --platform web && cd ..
npx firebase-tools login
npx firebase-tools deploy --only hosting --project <your-project-id>
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Unit shows `cloud: AUTH_FAILED` | Wrong API key, device e-mail or password; Email/Password sign-in not enabled |
| Unit shows `cloud: WAITING_FOR_TIME` | No internet, or NTP blocked on the network |
| Unit shows `cloud: ERROR` | Device UID missing from `members`, wrong Device ID in step 5, or rules not published |
| App: "not a member of that unit" | Owner UID missing from `members`, or wrong Device ID typed in the app |
| App shows Offline but the unit works | Unit lost Wi-Fi or internet; local control is unaffected |
| Commands answer "request reached the unit too late" | Unit's internet is very slow or was down when you tapped |
