// Pure helpers shared by the screens. No React Native or Firebase imports, so
// this file is covered by `npm test` (Node's built-in test runner).

export type DeviceStatus = {
  schema: number;
  fw: string;
  deviceId: string;
  tankName: string;
  uptimeS: number;
  ts: number;
  updatedAt?: number;
  level?: {
    valid: boolean;
    percent?: number;
    litres?: number;
    distanceCm?: number;
    ageMs?: number;
    highHigh?: boolean;
  };
  mode: 'AUTO' | 'MANUAL' | 'MAINTENANCE';
  phase: 'DISARMED' | 'IDLE' | 'FILLING' | 'FAULT' | 'RETRY_WAIT';
  armed: boolean;
  commissioned: boolean;
  remoteControl: boolean;
  muted: boolean;
  valve: {
    commanded: boolean;
    fillRuntimeS: number;
    manualRemainingS: number;
    openBlocker: string;
    fillCount: number;
    lastFillS: number;
  };
  inputs: { floatHealthy: boolean; estopHealthy: boolean; k1Enabled: boolean };
  // Firebase drops empty arrays, so these may be missing.
  faults?: string[];
  warnings?: string[];
  lastDeny?: string;
  wifi?: { connected: boolean; rssi: number };
  // Present only when power saving is switched on at the unit. sleepUntil
  // (epoch seconds) is set in the last report before a sleep.
  power?: { sleepMinutes: number; sleepUntil?: number };
  // Present only when the supply schedule is switched on.
  schedule?: { clockKnown: boolean; open: boolean; waiting: boolean; lowLevelFill?: boolean };
  // True only for the firmware's bench-test build (pretend sensor and inputs).
  simulated?: boolean;
};

export type DeviceConfig = Record<string, string | number | boolean>;

export type HistoryPoint = { t: number; p: number; v: 0 | 1 };

export type DeviceEvent = {
  id: string;
  at?: number;
  ts?: number;
  uptimeS?: number;
  event: string;
  detail?: string;
  arg?: number;
};

// ------------------------------------------------------------------ status

/** The unit rewrites its status every 5 s; three missed updates means offline. */
export const ONLINE_WINDOW_MS = 20_000;

export function isOnline(status: DeviceStatus | null, serverNowMs: number): boolean {
  if (!status?.updatedAt) return false;
  return serverNowMs - status.updatedAt < ONLINE_WINDOW_MS;
}

/** Grace after the announced wake time before the unit counts as offline. */
export const WAKE_GRACE_MS = 120_000;

/** The unit said it was going to sleep and its wake time has not passed. */
export function isSleeping(status: DeviceStatus | null, serverNowMs: number): boolean {
  const until = status?.power?.sleepUntil;
  return !!until && !isOnline(status, serverNowMs) && serverNowMs < until * 1000 + WAKE_GRACE_MS;
}

/** A level may only be shown as current when the unit is online and trusts it. */
export function levelIsCurrent(status: DeviceStatus | null, online: boolean): boolean {
  return !!status && online && !!status.level?.valid && status.level.percent !== undefined;
}

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

export function headline(
  status: DeviceStatus | null,
  online: boolean,
  serverNowMs?: number,
): { tone: Tone; text: string } {
  if (!status) return { tone: 'muted', text: 'Waiting for the unit to report' };
  if (!online && serverNowMs !== undefined && isSleeping(status, serverNowMs)) {
    const minutes = Math.max(1, Math.ceil((status.power!.sleepUntil! * 1000 - serverNowMs) / 60_000));
    return { tone: 'info', text: `Power saving: asleep, next report in about ${minutes} min. Showing the last report` };
  }
  if (!online) return { tone: 'muted', text: 'Unit offline: showing the last report' };
  const faults = status.faults ?? [];
  if (faults.length) return { tone: 'bad', text: faults.map(humanize).join(' · ') };
  if (!status.commissioned) return { tone: 'warn', text: 'Not commissioned' };
  if (!status.armed) return { tone: 'warn', text: 'Disarmed: acknowledge to arm' };
  if (!status.level?.valid) return { tone: 'warn', text: 'Sensor reading stale' };
  if (status.valve.commanded && status.schedule?.lowLevelFill) return { tone: 'info', text: 'Tank was very low: filling now (commanded)' };
  if (status.valve.commanded) return { tone: 'info', text: 'Filling (commanded)' };
  if (status.schedule?.waiting) return { tone: 'info', text: 'Level is low: waiting for the next filling time' };
  if ((status.warnings ?? []).length) return { tone: 'warn', text: (status.warnings ?? []).map(humanize).join(' · ') };
  return { tone: 'ok', text: 'Monitoring' };
}

const LABELS: Record<string, string> = {
  EMERGENCY_STOP: 'Emergency stop',
  HIGH_LEVEL_OR_FLOAT_LOOP_FAULT: 'High level or float loop fault',
  SYSTEM_FAULT_K1: 'Relay K1 system fault',
  SENSOR_FAULT: 'Sensor fault',
  FILL_TIMEOUT: 'Fill timeout',
  NO_PROGRESS: 'No level rise while filling',
  CONFIG_FAULT: 'Settings fault',
  E_STOP_ACTIVE: 'Emergency stop is active',
  FLOAT_LOOP_FAULT: 'Float is high or its loop is open',
  FLOAT_CLEAR_DELAY: 'Float must stay healthy for 30 s first',
  K1_DISABLED: 'Relay K1 is not enabled',
  SENSOR_STALE: 'Sensor reading is stale',
  DISARMED: 'Unit is disarmed',
  LEVEL_HIGH: 'Level is already at the stop point',
  WRONG_MODE: 'Switch to Manual or Maintenance first',
  LOCAL_ACK_REQUIRED: 'An emergency stop must be acknowledged at the unit',
  REMOTE_DISABLED: 'Remote control is switched off at the unit',
  NOT_COMMISSIONED: 'Unit is not commissioned',
  LOCAL_ONLY_SETTING: 'That setting can only be changed at the unit',
  STALE_COMMAND: 'The request reached the unit too late and was discarded',
  TIME_UNKNOWN: 'The unit has no clock time yet',
  NO_ANSWER: 'No answer from the unit. It may be offline',
  OUTSIDE_SCHEDULE: 'Outside the filling times',
  WAITING_FOR_SUPPLY_WINDOW: 'Level is low: waiting for the next filling time',
  SCHEDULE_CLOCK_UNKNOWN: 'The unit has no clock time, so the filling times are not applied',
  WRONG_PIN: 'Wrong PIN',
  PIN_LOCKED: 'Too many wrong PINs. Try again in 5 minutes',
  PERMISSION_DENIED: 'This account is not allowed to change this unit',
  SCHEDULE_WINDOW_EMPTY: 'A filling time must start and end at different times',
  SCHEDULE_NO_DAYS: 'Switch on at least one day',
  LOW_LEVEL_FILL: 'Tank was very low: filling outside the filling times',
  LOW_LEVEL_FILL_NOT_BELOW_START: 'The low level must be below the start point',
  LOW_LEVEL_FILL_RANGE: 'The low level is out of range',
  NONE: 'Nothing',
};

/** FILL_TIMEOUT -> "Fill timeout". Known codes get a fuller sentence. */
export function humanize(code: string | undefined): string {
  if (!code) return '';
  if (LABELS[code]) return LABELS[code];
  const text = code.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// ----------------------------------------------------------------- history

/** UTC day bucket keys (YYYYMMDD) covering the window that ends at `nowMs`. */
export function dayKeys(nowMs: number, hours: number): string[] {
  const keys: string[] = [];
  const end = new Date(nowMs);
  const cursor = new Date(nowMs - hours * 3_600_000);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(
      `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`,
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** Turns one day bucket ({ "HHMM": { p, v } }) into time-stamped points. */
export function parseDay(dayKey: string, bucket: unknown): HistoryPoint[] {
  if (!/^\d{8}$/.test(dayKey) || !bucket || typeof bucket !== 'object') return [];
  const y = Number(dayKey.slice(0, 4));
  const mo = Number(dayKey.slice(4, 6)) - 1;
  const d = Number(dayKey.slice(6, 8));
  const points: HistoryPoint[] = [];
  for (const [hhmm, raw] of Object.entries(bucket as Record<string, any>)) {
    if (!/^\d{4}$/.test(hhmm) || typeof raw?.p !== 'number') continue;
    const t = Date.UTC(y, mo, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)));
    points.push({ t, p: Math.min(100, Math.max(0, raw.p)), v: raw.v ? 1 : 0 });
  }
  return points.sort((a, b) => a.t - b.t);
}

/**
 * Splits points into runs wherever samples are missing, so the chart shows a
 * gap instead of drawing a line through time the unit was offline or stale.
 */
export function splitAtGaps(points: HistoryPoint[], maxGapMs = 16 * 60_000): HistoryPoint[][] {
  const runs: HistoryPoint[][] = [];
  for (const point of points) {
    const run = runs[runs.length - 1];
    if (run && point.t - run[run.length - 1].t <= maxGapMs) run.push(point);
    else runs.push([point]);
  }
  return runs;
}

export function summarize(points: HistoryPoint[]) {
  if (!points.length) return null;
  let min = points[0];
  let max = points[0];
  let fills = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].p < min.p) min = points[i];
    if (points[i].p > max.p) max = points[i];
    if (points[i].v === 1 && (i === 0 || points[i - 1].v === 0)) fills++;
  }
  return { min, max, fills, last: points[points.length - 1] };
}

// ---------------------------------------------------------------- settings

export type Field = {
  key: string;
  label: string;
  unit?: string;
  kind: 'text' | 'number' | 'integer' | 'boolean';
  min?: number;
  max?: number;
  help?: string;
  /** Calibration values are changed at the unit only (local dashboard). */
  localOnly?: boolean;
};

export const SETTINGS: { title: string; fields: Field[] }[] = [
  {
    title: 'Tank',
    fields: [
      { key: 'tankName', label: 'Tank name', kind: 'text' },
      { key: 'usableCapacityLitres', label: 'Usable capacity', unit: 'L', kind: 'number', min: 1, max: 100000 },
    ],
  },
  {
    title: 'Filling thresholds',
    fields: [
      { key: 'startFillPercent', label: 'Start filling at', unit: '%', kind: 'number', min: 0, max: 99 },
      { key: 'stopFillPercent', label: 'Stop filling at', unit: '%', kind: 'number', min: 1, max: 99 },
      { key: 'highHighPercent', label: 'High-high backstop', unit: '%', kind: 'number', min: 2, max: 100 },
    ],
  },
  {
    title: 'Fill supervision',
    fields: [
      { key: 'maximumFillMinutes', label: 'Maximum fill time', unit: 'min', kind: 'integer', min: 1, max: 120 },
      { key: 'progressWindowMinutes', label: 'Warn if no rise for', unit: 'min', kind: 'integer', min: 1, max: 60 },
      { key: 'minRisePercent', label: 'Rise that counts as progress', unit: '%', kind: 'number', min: 0.1, max: 20 },
      { key: 'noProgressStopMinutes', label: 'Stop if no rise for', unit: 'min', kind: 'integer', min: 1, max: 120 },
      { key: 'autoRetry', label: 'Retry automatically after a no-rise stop', kind: 'boolean' },
      { key: 'retryMinutes', label: 'Retry after', unit: 'min', kind: 'integer', min: 5, max: 720 },
      { key: 'manualOpenMinutes', label: 'Manual open limit', unit: 'min', kind: 'integer', min: 1, max: 15 },
      { key: 'maintenanceMinutes', label: 'Maintenance mode limit', unit: 'min', kind: 'integer', min: 1, max: 30 },
    ],
  },
  {
    title: 'Indication',
    fields: [
      { key: 'ledBrightnessPercent', label: 'LED brightness', unit: '%', kind: 'integer', min: 1, max: 100 },
      { key: 'buzzerEnabled', label: 'Buzzer enabled', kind: 'boolean' },
    ],
  },
  {
    title: 'Calibration (set at the unit)',
    fields: [
      { key: 'fullDistanceCm', label: 'Full distance', unit: 'cm', kind: 'number', localOnly: true },
      { key: 'emptyDistanceCm', label: 'Empty distance', unit: 'cm', kind: 'number', localOnly: true },
      { key: 'validDistanceMinCm', label: 'Valid distance minimum', unit: 'cm', kind: 'number', localOnly: true },
      { key: 'validDistanceMaxCm', label: 'Valid distance maximum', unit: 'cm', kind: 'number', localOnly: true },
      { key: 'commissioned', label: 'Commissioned', kind: 'boolean', localOnly: true },
    ],
  },
];

export type Draft = Record<string, string | boolean>;

export function draftFromConfig(config: DeviceConfig): Draft {
  const draft: Draft = {};
  for (const group of SETTINGS) {
    for (const f of group.fields) {
      const v = config[f.key];
      if (v === undefined) continue;
      draft[f.key] = f.kind === 'boolean' ? Boolean(v) : String(v);
    }
  }
  return draft;
}

/**
 * Compares a form draft with the unit's settings. Returns only the changed,
 * remotely editable values, or the first problem found. The unit validates
 * again and has the final say.
 */
export function buildPatch(
  config: DeviceConfig,
  draft: Draft,
): { patch: DeviceConfig; error?: undefined } | { error: string; patch?: undefined } {
  const patch: DeviceConfig = {};
  const merged: DeviceConfig = { ...config };
  for (const group of SETTINGS) {
    for (const f of group.fields) {
      if (f.localOnly || draft[f.key] === undefined) continue;
      let value: string | number | boolean;
      if (f.kind === 'boolean') {
        value = Boolean(draft[f.key]);
      } else if (f.kind === 'text') {
        value = String(draft[f.key]).trim();
        if (!value) return { error: `${f.label} cannot be empty` };
        if (value.length > 23) return { error: `${f.label} must be 23 characters or fewer` };
      } else {
        const text = String(draft[f.key]).trim().replace(',', '.');
        if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return { error: `${f.label} must be a number` };
        value = Number(text);
        if (f.kind === 'integer' && !Number.isInteger(value)) return { error: `${f.label} must be a whole number` };
        if (f.min !== undefined && value < f.min) return { error: `${f.label} must be at least ${f.min}` };
        if (f.max !== undefined && value > f.max) return { error: `${f.label} must be at most ${f.max}` };
      }
      merged[f.key] = value;
      if (value !== config[f.key]) patch[f.key] = value;
    }
  }
  const start = Number(merged.startFillPercent);
  const stop = Number(merged.stopFillPercent);
  const high = Number(merged.highHighPercent);
  if (!(start < stop)) return { error: 'Start filling must be below stop filling' };
  if (!(stop < high)) return { error: 'Stop filling must be below the high-high backstop' };
  if (Number(merged.noProgressStopMinutes) < Number(merged.progressWindowMinutes)) {
    return { error: 'The no-rise stop time cannot be shorter than the warning time' };
  }
  if (Number(merged.manualOpenMinutes) > Number(merged.maximumFillMinutes)) {
    return { error: 'Manual open limit cannot exceed the maximum fill time' };
  }
  return { patch };
}

/** Device IDs look like ag-1a2b3c; also guards the database path. */
export function normalizeDeviceId(input: string): string | null {
  const id = input.trim().toLowerCase();
  return /^ag-[0-9a-f]{6}$/.test(id) ? id : null;
}

// ------------------------------------------------------------ saved units

/** A unit this phone has connected to. The list is kept on the phone only. */
export type SavedUnit = { id: string; name: string };

export const MAX_SAVED_UNITS = 12;

function cleanUnitName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, 40) : '';
}

/** Reads the stored list. Anything malformed is dropped, never trusted. */
export function parseSavedUnits(raw: string | null | undefined): SavedUnit[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedUnit[] = [];
  for (const item of data) {
    const id = normalizeDeviceId(typeof item?.id === 'string' ? item.id : '');
    if (!id || out.some((u) => u.id === id)) continue;
    out.push({ id, name: cleanUnitName(item?.name) });
    if (out.length >= MAX_SAVED_UNITS) break;
  }
  return out;
}

/**
 * Adds a unit, or updates the name of one already saved. The order never
 * changes, so a unit stays in the same place in the list. A missing name
 * keeps the name already saved. Returns the same array when nothing changed.
 */
export function upsertUnit(list: SavedUnit[], id: string, name?: string): SavedUnit[] {
  const clean = cleanUnitName(name);
  const at = list.findIndex((u) => u.id === id);
  if (at >= 0) {
    if (!clean || list[at].name === clean) return list;
    return list.map((u, i) => (i === at ? { id, name: clean } : u));
  }
  if (list.length >= MAX_SAVED_UNITS) return list;
  return [...list, { id, name: clean }];
}

export function removeUnit(list: SavedUnit[], id: string): SavedUnit[] {
  return list.filter((u) => u.id !== id);
}

/** Name to show for a unit. Until the unit has reported its name, the ID. */
export function unitLabel(unit: SavedUnit): string {
  return unit.name || unit.id;
}

// ---------------------------------------------------------- filling times

export const MINUTES_PER_DAY = 1440;

/** One day's filling time. Minutes after midnight, at the unit's local time. */
export type DayWindow = { on: boolean; start: number; end: number };

export type Schedule = {
  enabled: boolean;
  /** Index 0 = Sunday .. 6 = Saturday, as the unit counts them. */
  days: DayWindow[];
  /** Fill at any time when the level is at or below this. 0 = switched off. */
  lowLevel: number;
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** Monday first, the order the week is shown in. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const DEFAULT_LOW_LEVEL = 15;

/** null when the unit's firmware is too old to have a filling time per day. */
export function scheduleFromConfig(config: DeviceConfig | null): Schedule | null {
  if (!config || config.scheduleEnabled === undefined || config.scheduleDays === undefined) return null;
  const mask = Number(config.scheduleDays);
  return {
    enabled: Boolean(config.scheduleEnabled),
    days: DAY_KEYS.map((key, d) => ({
      on: ((mask >> d) & 1) === 1,
      start: Number(config[`${key}StartMin`] ?? 0),
      end: Number(config[`${key}EndMin`] ?? 480),
    })),
    lowLevel: Number(config.lowLevelFillPercent ?? DEFAULT_LOW_LEVEL),
  };
}

/** Only the values that differ from what the unit has now. */
export function schedulePatch(
  config: DeviceConfig,
  draft: Schedule,
): { patch: DeviceConfig; error?: undefined } | { error: string; patch?: undefined } {
  for (const d of WEEK_ORDER) {
    if (draft.days[d].start === draft.days[d].end) return { error: `${DAY_NAMES[d]}: the start and end times are the same` };
  }
  if (draft.enabled && !draft.days.some((day) => day.on)) return { error: 'Switch on at least one day, or switch the filling times off' };
  const startPoint = Number(config.startFillPercent);
  if (draft.lowLevel < 0 || (draft.lowLevel > 0 && Number.isFinite(startPoint) && draft.lowLevel >= startPoint)) {
    return { error: `The low level must be below the start point (${startPoint}%)` };
  }
  const patch: DeviceConfig = {};
  const put = (key: string, value: number | boolean) => {
    if (config[key] !== value) patch[key] = value;
  };
  put('scheduleEnabled', draft.enabled);
  put('scheduleDays', draft.days.reduce((mask, day, d) => (day.on ? mask | (1 << d) : mask), 0));
  DAY_KEYS.forEach((key, d) => {
    put(`${key}StartMin`, draft.days[d].start);
    put(`${key}EndMin`, draft.days[d].end);
  });
  put('lowLevelFillPercent', draft.lowLevel);
  return { patch };
}

/** Copies one day's filling time onto other days. */
export function copyDay(s: Schedule, from: number, to: readonly number[]): Schedule {
  return { ...s, days: s.days.map((day, d) => (to.includes(d) ? { ...s.days[from] } : day)) };
}

/**
 * Groups days that share a filling time, for a short summary:
 * "Mon to Fri" / "Sat, Sun". Monday first.
 */
export function groupDays(s: Schedule): { label: string; days: number[]; window: DayWindow }[] {
  const groups: { days: number[]; window: DayWindow }[] = [];
  for (const d of WEEK_ORDER) {
    const w = s.days[d];
    const match = groups.find((g) => g.window.on === w.on && (!w.on || (g.window.start === w.start && g.window.end === w.end)));
    if (match) match.days.push(d);
    else groups.push({ days: [d], window: w });
  }
  const short = (d: number) => DAY_NAMES[d].slice(0, 3);
  return groups.map((g) => {
    const at = g.days.map((d) => WEEK_ORDER.indexOf(d as (typeof WEEK_ORDER)[number]));
    const run = at.every((v, i) => i === 0 || v === at[i - 1] + 1);
    const label =
      g.days.length === 7 ? 'Every day' : run && g.days.length > 2 ? `${short(g.days[0])} to ${short(g.days[g.days.length - 1])}` : g.days.map(short).join(', ');
    return { label, ...g };
  });
}

/** 0 -> "12:00 am", 810 -> "1:30 pm". */
export function formatClock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Moves a time by `delta` minutes, wrapping round midnight. */
export function stepClock(minuteOfDay: number, delta: number): number {
  return (((minuteOfDay + delta) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Length of a window in minutes; a start after the end runs past midnight. */
export function windowMinutes(start: number, end: number): number {
  return end > start ? end - start : end + MINUTES_PER_DAY - start;
}

/** "12:00 am to 8:00 am (8 h)"; says "next day" when it runs past midnight. */
export function describeWindow(start: number, end: number): string {
  const length = windowMinutes(start, end);
  const hours = Math.floor(length / 60);
  const mins = length % 60;
  const lengthText = hours && mins ? `${hours} h ${mins} min` : hours ? `${hours} h` : `${mins} min`;
  return `${formatClock(start)} to ${formatClock(end)}${end < start ? ' next day' : ''} (${lengthText})`;
}

/** Parts of the day covered by a window, as fractions 0..1, for the day bar. */
export function windowSegments(start: number, end: number): { from: number; to: number }[] {
  if (start === end) return [];
  if (start < end) return [{ from: start / MINUTES_PER_DAY, to: end / MINUTES_PER_DAY }];
  const parts = [{ from: start / MINUTES_PER_DAY, to: 1 }];
  if (end > 0) parts.unshift({ from: 0, to: end / MINUTES_PER_DAY });
  return parts;
}

/**
 * The unit's own rule, mirrored for the demo and for previews. dayOfWeek:
 * 0 = Sunday .. 6 = Saturday. A window that runs past midnight belongs to the
 * day it started on; a day that is switched off has no window.
 */
export function scheduleAllows(s: Schedule, dayOfWeek: number, minuteOfDay: number): boolean {
  if (!s.enabled) return true;
  const today = s.days[dayOfWeek];
  if (today.on && (today.start < today.end ? minuteOfDay >= today.start && minuteOfDay < today.end : minuteOfDay >= today.start)) return true;
  const yesterday = s.days[(dayOfWeek + 6) % 7];
  return yesterday.on && yesterday.start > yesterday.end && minuteOfDay < yesterday.end;
}

/** Day of week and minute of day at the unit, from its UTC offset. */
export function unitClock(nowMs: number, utcOffsetMinutes: number): { dayOfWeek: number; minuteOfDay: number } {
  const local = new Date(nowMs + utcOffsetMinutes * 60_000);
  return { dayOfWeek: local.getUTCDay(), minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** 330 -> "UTC+5:30". */
export function formatUtcOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? '-' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}

/** The settings PIN is 4 to 8 digits. */
export function pinLooksValid(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
