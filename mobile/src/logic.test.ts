// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPatch,
  dayKeys,
  draftFromConfig,
  formatDuration,
  headline,
  humanize,
  isOnline,
  levelIsCurrent,
  normalizeDeviceId,
  parseDay,
  splitAtGaps,
  summarize,
  type DeviceConfig,
  type DeviceStatus,
} from './logic.ts';

const baseStatus: DeviceStatus = {
  schema: 1,
  fw: '0.1.0',
  deviceId: 'ag-1a2b3c',
  tankName: 'Roof tank',
  uptimeS: 100,
  ts: 0,
  updatedAt: 1_000_000,
  level: { valid: true, percent: 75, litres: 750, distanceCm: 62.5, ageMs: 100 },
  mode: 'AUTO',
  phase: 'IDLE',
  armed: true,
  commissioned: true,
  remoteControl: true,
  muted: false,
  valve: { commanded: false, fillRuntimeS: 0, manualRemainingS: 0, openBlocker: 'NONE', fillCount: 0, lastFillS: 0 },
  inputs: { floatHealthy: true, estopHealthy: true, k1Enabled: true },
};

const baseConfig: DeviceConfig = {
  tankName: 'Roof tank',
  usableCapacityLitres: 1000,
  startFillPercent: 35,
  stopFillPercent: 90,
  highHighPercent: 95,
  maximumFillMinutes: 120,
  progressWindowMinutes: 10,
  minRisePercent: 1,
  noProgressStopMinutes: 20,
  autoRetry: false,
  retryMinutes: 30,
  manualOpenMinutes: 5,
  maintenanceMinutes: 10,
  ledBrightnessPercent: 20,
  buzzerEnabled: true,
  fullDistanceCm: 35,
  emptyDistanceCm: 145,
  validDistanceMinCm: 30,
  validDistanceMaxCm: 600,
  commissioned: true,
};

test('online only while status updates keep arriving', () => {
  assert.equal(isOnline(baseStatus, 1_005_000), true);
  assert.equal(isOnline(baseStatus, 1_020_000), false);
  assert.equal(isOnline(null, 1_000_000), false);
  assert.equal(isOnline({ ...baseStatus, updatedAt: undefined }, 1_000_000), false);
});

test('a level is never shown as current when offline or stale', () => {
  assert.equal(levelIsCurrent(baseStatus, true), true);
  assert.equal(levelIsCurrent(baseStatus, false), false);
  assert.equal(levelIsCurrent({ ...baseStatus, level: { valid: false, percent: 75 } }, true), false);
  assert.equal(levelIsCurrent({ ...baseStatus, level: undefined }, true), false);
});

test('headline puts faults first and tolerates missing arrays', () => {
  assert.deepEqual(headline(baseStatus, true), { tone: 'ok', text: 'Monitoring' });
  assert.equal(headline({ ...baseStatus, faults: ['EMERGENCY_STOP'], armed: false }, true).tone, 'bad');
  assert.equal(headline({ ...baseStatus, faults: ['EMERGENCY_STOP'] }, true).text, 'Emergency stop');
  assert.equal(headline({ ...baseStatus, armed: false }, true).tone, 'warn');
  assert.equal(headline({ ...baseStatus, faults: ['EMERGENCY_STOP'] }, false).tone, 'muted');
  assert.equal(headline(null, false).tone, 'muted');
  assert.equal(
    headline({ ...baseStatus, valve: { ...baseStatus.valve, commanded: true } }, true).text,
    'Filling (commanded)',
  );
});

test('humanize', () => {
  assert.equal(humanize('REMOTE_DISABLED'), 'Remote control is switched off at the unit');
  assert.equal(humanize('SOME_NEW_CODE'), 'Some new code');
  assert.equal(humanize(undefined), '');
});

test('formatDuration', () => {
  assert.equal(formatDuration(42), '42 s');
  assert.equal(formatDuration(125), '2 min 5 s');
  assert.equal(formatDuration(3 * 3600 + 120), '3 h 2 min');
  assert.equal(formatDuration(3 * 86400 + 3600), '3 d 1 h');
});

test('dayKeys covers the window across a month boundary in UTC', () => {
  const now = Date.UTC(2026, 10, 1, 2, 0); // 1 Nov 2026 02:00 UTC
  assert.deepEqual(dayKeys(now, 24), ['20261031', '20261101']);
  assert.deepEqual(dayKeys(now, 1), ['20261101']);
  assert.equal(dayKeys(now, 24 * 7).length, 8);
});

test('parseDay sorts, clamps and skips malformed samples', () => {
  const points = parseDay('20261113', {
    '0010': { p: 50.5, v: 0 },
    '0005': { p: 140, v: 1 },
    bad: { p: 1 },
    '0015': { v: 1 },
  });
  assert.equal(points.length, 2);
  assert.equal(points[0].t, Date.UTC(2026, 10, 13, 0, 5));
  assert.equal(points[0].p, 100);
  assert.equal(points[0].v, 1);
  assert.equal(points[1].p, 50.5);
  assert.deepEqual(parseDay('nonsense', {}), []);
  assert.deepEqual(parseDay('20261113', null), []);
});

test('splitAtGaps breaks the line where samples are missing', () => {
  const m = 60_000;
  const pts = [0, 5, 10, 60, 65].map((x) => ({ t: x * m, p: 50, v: 0 as const }));
  const runs = splitAtGaps(pts);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].length, 3);
  assert.equal(runs[1].length, 2);
  assert.deepEqual(splitAtGaps([]), []);
});

test('summarize counts fills by rising edges', () => {
  const pts = [40, 36, 45, 70, 90, 88, 34, 50].map((p, i) => ({
    t: i * 300_000,
    p,
    v: (i >= 2 && i <= 3) || i === 7 ? (1 as const) : (0 as const),
  }));
  const s = summarize(pts)!;
  assert.equal(s.min.p, 34);
  assert.equal(s.max.p, 90);
  assert.equal(s.fills, 2);
  assert.equal(s.last.p, 50);
  assert.equal(summarize([]), null);
});

test('buildPatch sends only what changed', () => {
  const draft = draftFromConfig(baseConfig);
  assert.deepEqual(buildPatch(baseConfig, draft), { patch: {} });
  draft.stopFillPercent = '85';
  draft.buzzerEnabled = false;
  draft.tankName = '  Kitchen tank ';
  assert.deepEqual(buildPatch(baseConfig, draft), {
    patch: { stopFillPercent: 85, buzzerEnabled: false, tankName: 'Kitchen tank' },
  });
});

test('buildPatch never includes calibration, even if the draft was altered', () => {
  const draft = draftFromConfig(baseConfig);
  draft.fullDistanceCm = '10';
  draft.commissioned = false;
  assert.deepEqual(buildPatch(baseConfig, draft), { patch: {} });
});

test('buildPatch rejects bad input with a readable reason', () => {
  const bad = (change: Record<string, string | boolean>) =>
    buildPatch(baseConfig, { ...draftFromConfig(baseConfig), ...change }).error;
  assert.match(bad({ stopFillPercent: 'abc' })!, /must be a number/);
  assert.match(bad({ maximumFillMinutes: '500' })!, /at most 120/);
  assert.match(bad({ maximumFillMinutes: '10.5' })!, /whole number/);
  assert.match(bad({ startFillPercent: '90' })!, /below stop/);
  assert.match(bad({ stopFillPercent: '95' })!, /below the high-high/);
  assert.match(bad({ tankName: '   ' })!, /cannot be empty/);
  assert.match(bad({ noProgressStopMinutes: '5' })!, /warning time/);
  assert.equal(bad({ minRisePercent: '1,5' }), undefined); // decimal comma accepted
});

test('normalizeDeviceId', () => {
  assert.equal(normalizeDeviceId(' AG-1A2B3C '), 'ag-1a2b3c');
  assert.equal(normalizeDeviceId('ag-12'), null);
  assert.equal(normalizeDeviceId('../users'), null);
});
