# AquaGuard: project rules

Smart water tank controller: ESP32-S3 firmware, a phone app, and Firebase for
remote access. Repository: https://github.com/RavinduSandeep/AquaGuard

## After every prompt that changes the project

The owner wants the documentation and version numbers kept current on every
request. Before finishing a turn that changed any file:

1. **Update `README.md`**: the "Current versions" table, the status column,
   "Known gaps", and the "Latest update" section at the bottom (date plus a
   two or three sentence summary of this change). Update `firmware/README.md`
   or `mobile/README.md` too when their content is affected.
2. **Bump the version** of each program you changed in `versions.json`
   (PATCH for fixes, MINOR for features, MAJOR for breaking changes; bump
   `dataSchema` if the shared data shape changed), then run
   `node scripts/sync-versions.mjs`. Never edit the generated files by hand
   (`firmware/include/version.h`, `mobile/src/version.ts`, the versions in
   `mobile/package.json` and `mobile/app.json`).
3. **Add an entry to `CHANGELOG.md`** under today's date, one heading per
   program with its new version.

Documentation-only changes do not need a version bump.

## The project guide is the specification

`documents/AquaGuard_ESP32_S3_Complete_Project_and_Sri_Lanka_Buying_Guide.docx`
defines the hardware, pin map, control behaviour, settings, API and tests.
Read the relevant section before changing behaviour. If code must differ from
the guide, list the difference under "Differences from the guide" in
`firmware/README.md`.

To read the .docx as text: unzip it and extract `word/document.xml`
(Python's `zipfile` + `xml.etree` is enough).

## Safety rules for the code

- Only `firmware/src/control.cpp` writes the valve GPIO, and only with
  `SafetyManager::valveRequest()`. Everything else submits a request.
- Network, display, flash and cloud code must never block the control task.
- Missing, stale or invalid sensor data must never be treated as an empty tank.
- Local operation and safety must never depend on Wi-Fi, the internet or Firebase.
- Remote requests are less trusted than local ones: emergency-stop
  acknowledgement, calibration and the remote-control switch stay local-only.
- Any change to `lib/aquaguard_core` needs a test in `firmware/test/test_core`.
- Be honest in the docs about what has and has not been tested on real hardware.

## Checks to run

```bash
node scripts/sync-versions.mjs --check
cd firmware && pio test -e native && pio run -e aquaguard_s3
cd mobile && npm run typecheck && npm test
```

PlatformIO may not be on PATH; install it with `pip install platformio` in a
virtual environment if needed.

## Layout

- `firmware/`: see `firmware/README.md`. Core logic is in
  `lib/aquaguard_core` (no Arduino includes, natively testable).
- `mobile/`: see `mobile/AGENTS.md`.
- `firebase/database.rules.json`: access rules; `firebase.json` at the root.
- `docs/firebase-setup.md`: remote access setup and the data layout.

Commit or push only when the owner asks.
