# AquaGuard mobile app

Expo / React Native app (Android, iOS, web) for the AquaGuard tank controller.
Read the root `CLAUDE.md` first: it holds the project-wide rules (README and
CHANGELOG updates, version numbers, safety constraints).

## Expo has changed: do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches
an Expo, EAS, or React Native API, read the `expo` major version in
`package.json` and check the matching docs at
`https://docs.expo.dev/versions/v<major>.0.0/` (index: https://docs.expo.dev/llms.txt).

## Commands

```bash
npx expo install <package>  # always use this instead of npm install <package>
npx expo start              # dev server (scan the QR code with Expo Go)
npm run typecheck           # tsc --noEmit
npm test                    # unit tests for src/logic.ts
npx expo-doctor             # dependency and config checks
```

Run typecheck and tests before declaring a task done.

## Structure

- `App.tsx`: sign-in, device pairing, and a simple state-driven tab bar. There
  are six flat tabs and no deep links, so Expo Router is deliberately not used.
- `src/logic.ts`: pure helpers (no React Native or Firebase imports) so they
  run under `node --test`. Put new testable logic here.
- `src/data.ts`: Firebase hooks and requests. `src/firebase.ts`: connection.
- `src/demo.ts`: simulated unit for demo mode. Every hook and request in
  `data.ts` branches to it when `demoActive()`; keep the two in step.
- `src/screens/`: one file per tab. `src/ui.tsx`: theme and shared components.
- `src/version.ts`, the `version` in `package.json` and `app.json`: generated
  by `node ../scripts/sync-versions.mjs` from the root `versions.json`. Do not
  edit them by hand.

## Rules

- The app never controls the valve directly. It writes a request; the unit's
  SafetyManager decides. Show the unit's refusal reason to the user.
- Never show a level as current when the unit is offline or the reading is
  stale (`levelIsCurrent`).
- Only libraries that work in Expo Go (no custom native code), so the app can
  be run on a phone with no paid developer account.
- Do not create or edit `ios/` or `android/` by hand.
