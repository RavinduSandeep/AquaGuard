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

/** A level may only be shown as current when the unit is online and trusts it. */
export function levelIsCurrent(status: DeviceStatus | null, online: boolean): boolean {
  return !!status && online && !!status.level?.valid && status.level.percent !== undefined;
}

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

export function headline(status: DeviceStatus | null, online: boolean): { tone: Tone; text: string } {
  if (!status) return { tone: 'muted', text: 'Waiting for the unit to report' };
  if (!online) return { tone: 'muted', text: 'Unit offline: showing the last report' };
  const faults = status.faults ?? [];
  if (faults.length) return { tone: 'bad', text: faults.map(humanize).join(' · ') };
  if (!status.commissioned) return { tone: 'warn', text: 'Not commissioned' };
  if (!status.armed) return { tone: 'warn', text: 'Disarmed: acknowledge to arm' };
  if (!status.level?.valid) return { tone: 'warn', text: 'Sensor reading stale' };
  if (status.valve.commanded) return { tone: 'info', text: 'Filling (commanded)' };
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
