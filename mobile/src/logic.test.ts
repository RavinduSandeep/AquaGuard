// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPatch,
  describeWindow,
  formatClock,
  formatUtcOffset,
  pinLooksValid,
  scheduleAllows,
  scheduleFromConfig,
  schedulePatch,
  stepClock,
  unitClock,
  windowSegments,
  type Schedule,
  dayKeys,
  draftFromConfig,
  formatDuration,
  headline,
  isSleeping,
  humanize,
  isOnline,
  levelIsCurrent,
  MAX_SAVED_UNITS,
  normalizeDeviceId,
  parseSavedUnits,
  removeUnit,
  unitLabel,
  upsertUnit,
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

test('a unit that announced a sleep is shown as asleep, then as offline', () => {
  const t0 = 1_800_000_000_000;
  const asleep = { ...baseStatus, updatedAt: t0, power: { sleepMinutes: 10, sleepUntil: t0 / 1000 + 600 } };
  assert.equal(isSleeping(asleep, t0 + 5_000), false); // still reporting
  assert.equal(isSleeping(asleep, t0 + 300_000), true);
  assert.match(headline(asleep, false, t0 + 300_000).text, /Power saving/);
  assert.equal(levelIsCurrent(asleep, false), false); // the level is still not shown as current
  assert.equal(isSleeping(asleep, t0 + 600_000 + 121_000), false); // missed its wake: offline
  assert.equal(headline(asleep, false, t0 + 600_000 + 121_000).tone, 'muted');
  assert.equal(isSleeping({ ...baseStatus, updatedAt: t0 }, t0 + 300_000), false);
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

const nights: Schedule = { enabled: true, weekdayStart: 0, weekdayEnd: 480, weekendStart: 0, weekendEnd: 480 };

test('clock times are shown in 12-hour form', () => {
  assert.equal(formatClock(0), '12:00 am');
  assert.equal(formatClock(480), '8:00 am');
  assert.equal(formatClock(720), '12:00 pm');
  assert.equal(formatClock(810), '1:30 pm');
  assert.equal(formatClock(1439), '11:59 pm');
  assert.equal(stepClock(0, -30), 1410);
  assert.equal(stepClock(1425, 30), 15);
});

test('a filling time is described, including one that runs past midnight', () => {
  assert.equal(describeWindow(0, 480), '12:00 am to 8:00 am (8 h)');
  assert.equal(describeWindow(1320, 330), '10:00 pm to 5:30 am next day (7 h 30 min)');
  assert.deepEqual(windowSegments(360, 720), [{ from: 0.25, to: 0.5 }]);
  assert.deepEqual(windowSegments(1080, 360), [{ from: 0, to: 0.25 }, { from: 0.75, to: 1 }]);
  assert.deepEqual(windowSegments(1080, 0), [{ from: 0.75, to: 1 }]);
});

test('the schedule rule matches the unit', () => {
  assert.equal(scheduleAllows({ ...nights, enabled: false }, 3, 800), true);
  assert.equal(scheduleAllows(nights, 3, 479), true);
  assert.equal(scheduleAllows(nights, 3, 480), false);
  const late: Schedule = { enabled: true, weekdayStart: 1320, weekdayEnd: 300, weekendStart: 540, weekendEnd: 660 };
  assert.equal(scheduleAllows(late, 4, 1380), true);
  assert.equal(scheduleAllows(late, 6, 240), true); // Saturday early: Friday's window
  assert.equal(scheduleAllows(late, 0, 240), false); // Sunday early: Saturday's did not wrap
  assert.equal(scheduleAllows(late, 6, 600), true);
});

test('the unit clock follows its UTC offset', () => {
  const mondayUtc = Date.UTC(2026, 10, 16, 0, 0);
  assert.deepEqual(unitClock(mondayUtc, 330), { dayOfWeek: 1, minuteOfDay: 330 });
  assert.deepEqual(unitClock(mondayUtc, -60), { dayOfWeek: 0, minuteOfDay: 1380 });
  assert.equal(formatUtcOffset(330), 'UTC+5:30');
  assert.equal(formatUtcOffset(-480), 'UTC-8');
  assert.equal(formatUtcOffset(0), 'UTC+0');
});

test('schedule changes become a patch of only what changed', () => {
  const config: DeviceConfig = { scheduleEnabled: false, weekdayStartMin: 0, weekdayEndMin: 480, weekendStartMin: 0, weekendEndMin: 480 };
  assert.equal(scheduleFromConfig({ tankName: 'old firmware' }), null);
  const current = scheduleFromConfig(config)!;
  assert.deepEqual(schedulePatch(config, current).patch, {});
  assert.deepEqual(schedulePatch(config, { ...current, enabled: true, weekendEnd: 600 }).patch, { scheduleEnabled: true, weekendEndMin: 600 });
  assert.match(schedulePatch(config, { ...current, weekdayEnd: 0 }).error!, /Weekdays/);
});

test('the PIN must be 4 to 8 digits', () => {
  assert.equal(pinLooksValid('4211'), true);
  assert.equal(pinLooksValid('12345678'), true);
  assert.equal(pinLooksValid('421'), false);
  assert.equal(pinLooksValid('42 11'), false);
  assert.equal(pinLooksValid('abcd'), false);
});

test('waiting for a filling time is the headline', () => {
  const waiting = { ...baseStatus, schedule: { clockKnown: true, open: false, waiting: true } };
  assert.equal(headline(waiting, true).tone, 'info');
  assert.match(headline(waiting, true).text, /waiting for the next filling time/);
});

test('saved units: stored list is read defensively', () => {
  assert.deepEqual(parseSavedUnits(null), []);
  assert.deepEqual(parseSavedUnits('not json'), []);
  assert.deepEqual(parseSavedUnits('{"id":"ag-1a2b3c"}'), []);
  assert.deepEqual(
    parseSavedUnits(JSON.stringify([{ id: 'AG-1A2B3C', name: ' Roof tank ' }, { id: '../users' }, { id: 'ag-1a2b3c', name: 'Twice' }, 7, { id: 'ag-000002' }])),
    [
      { id: 'ag-1a2b3c', name: 'Roof tank' },
      { id: 'ag-000002', name: '' },
    ],
  );
});

test('saved units: add, rename, remove', () => {
  let list = upsertUnit([], 'ag-000001', 'Roof tank');
  list = upsertUnit(list, 'ag-000002');
  assert.deepEqual(list.map(unitLabel), ['Roof tank', 'ag-000002']);

  // A unit that has not reported yet never wipes a saved name.
  assert.equal(upsertUnit(list, 'ag-000001'), list);
  assert.equal(upsertUnit(list, 'ag-000001', 'Roof tank'), list);

  list = upsertUnit(list, 'ag-000002', 'Garden tank');
  assert.deepEqual(list.map(unitLabel), ['Roof tank', 'Garden tank']); // order kept

  list = removeUnit(list, 'ag-000001');
  assert.deepEqual(list, [{ id: 'ag-000002', name: 'Garden tank' }]);
});

test('saved units: the list is capped', () => {
  let list: ReturnType<typeof parseSavedUnits> = [];
  for (let i = 0; i < MAX_SAVED_UNITS + 3; i++) list = upsertUnit(list, `ag-${i.toString(16).padStart(6, '0')}`);
  assert.equal(list.length, MAX_SAVED_UNITS);
});
