// Demo mode: a small simulated unit so the app can be explored with no
// Firebase project, no hardware and no phone. Nothing here talks to a network.
// The simulation is deliberately simple and is NOT the firmware's logic.
import { useEffect, useState } from 'react';

import { scheduleAllows, scheduleFromConfig, unitClock, type DeviceConfig, type DeviceEvent, type DeviceStatus, type HistoryPoint } from './logic';

export const DEMO_DEVICE_ID = 'ag-de0001';

let active = false;
export const demoActive = () => active;

type Entry = { id: string; kind: string; checks?: string[]; note?: string; by?: string; at?: number };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

let config: DeviceConfig;
let status: DeviceStatus;
let events: DeviceEvent[];
let history: HistoryPoint[];
let logbook: Entry[];
let record: Record<string, string>;
let timer: ReturnType<typeof setInterval> | null = null;
let bootedAt = 0;
let seq = 0;

function addEvent(event: string, detail?: string) {
  events = [{ id: `e${++seq}`, at: Date.now(), event, detail }, ...events].slice(0, 60);
}

function reset() {
  const now = Date.now();
  bootedAt = now - 3 * 86_400_000;
  fillStartedAt = now; // the sample history may end part-way through a fill
  config = {
    revision: 1, valid: true, tankName: 'Roof tank (demo)', usableCapacityLitres: 1000,
    startFillPercent: 35, stopFillPercent: 90, highHighPercent: 95,
    maximumFillMinutes: 120, progressWindowMinutes: 10, minRisePercent: 1, noProgressStopMinutes: 20,
    autoRetry: false, retryMinutes: 30, manualOpenMinutes: 5, maintenanceMinutes: 10,
    ledBrightnessPercent: 20, buzzerEnabled: true,
    scheduleEnabled: false, scheduleDays: 127, lowLevelFillPercent: 15, fillAtWindowStart: false, utcOffsetMinutes: -new Date().getTimezoneOffset(),
    ...Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].flatMap((d) => [[`${d}StartMin`, 0], [`${d}EndMin`, 480]])),
    fullDistanceCm: 35, emptyDistanceCm: 145, validDistanceMinCm: 30, validDistanceMaxCm: 600, commissioned: true,
  };

  // Seven days of 5-minute samples: slow use, then a fill from 35 % to 90 %.
  history = [];
  let p = 78;
  let v: 0 | 1 = 0;
  for (let t = now - 7 * 86_400_000; t <= now; t += 300_000) {
    const hour = new Date(t).getHours();
    if (p <= 35) v = 1;
    if (p >= 90) v = 0;
    p += v ? 2.3 : hour >= 6 && hour <= 22 ? -0.33 : -0.04;
    // One gap, as if the unit had been offline for a while.
    if (t > now - 30 * 3_600_000 && t < now - 28 * 3_600_000) continue;
    history.push({ t, p: Math.round(p * 10) / 10, v });
  }
  const last = history[history.length - 1];

  status = {
    schema: 4, fw: '0.7.0', deviceId: DEMO_DEVICE_ID, tankName: String(config.tankName),
    uptimeS: 3 * 86_400, ts: Math.floor(now / 1000), updatedAt: now,
    level: { valid: true, percent: last.p, litres: Math.round(last.p * 10), distanceCm: 145 - last.p * 1.1, ageMs: 200 },
    mode: 'AUTO', phase: last.v ? 'FILLING' : 'IDLE', armed: true, commissioned: true, remoteControl: true, muted: false,
    valve: { commanded: !!last.v, fillRuntimeS: 0, manualRemainingS: 0, openBlocker: 'NONE', fillCount: 4, lastFillS: 1440 },
    inputs: { floatHealthy: true, estopHealthy: true, k1Enabled: true },
    faults: [], warnings: [], wifi: { connected: true, rssi: -61 },
  };
  events = [];
  seq = 0;
  addEvent('FILL_COMPLETE');
  addEvent('FILL_START');
  addEvent('ARMED');
  addEvent('BOOT');
  logbook = [
    { id: 'l1', kind: 'Monthly check', checks: ['Raised the float by hand: valve shut off', 'Overflow path clear'], note: 'Sample entry.', by: 'demo', at: now - 9 * 86_400_000 },
  ];
  record = { board: 'ESP32-S3 DevKitC-1 N16R8 (sample)', capacity: '1000 L, vertical cylinder' };
}

let fillStartedAt = 0;
let manualUntil = 0;

function setValve(open: boolean, manual = false) {
  if (open === status.valve.commanded) return;
  if (open) {
    fillStartedAt = Date.now();
    manualUntil = manual ? fillStartedAt + Number(config.manualOpenMinutes) * 60_000 : 0;
    addEvent(manual ? 'MANUAL_OPEN' : 'FILL_START');
  } else {
    addEvent('FILL_STOPPED');
    status.valve.lastFillS = Math.round((Date.now() - fillStartedAt) / 1000);
    manualUntil = 0;
  }
  status.valve.commanded = open;
}

function blocker(): string {
  if (!status.armed) return 'DISARMED';
  if ((status.level?.percent ?? 0) >= Number(config.stopFillPercent)) return 'LEVEL_HIGH';
  return 'NONE';
}

export const DEMO_PIN = '4211';

// True while a fill is running outside the filling times because the tank was very low.
let lowFill = false;
let pausedUntil = 0; // automatic filling paused after Valve off
let wasOpen = true;
let topUpPending = false;

function windowOpen(now: number): boolean {
  const schedule = scheduleFromConfig(config);
  if (!schedule) return true;
  const clock = unitClock(now, Number(config.utcOffsetMinutes));
  return scheduleAllows(schedule, clock.dayOfWeek, clock.minuteOfDay);
}

// Runs much faster than a real tank so there is something to watch.
function tick() {
  const now = Date.now();
  const open = windowOpen(now);
  const lowPoint = Number(config.lowLevelFillPercent ?? 0);
  const veryLow = lowPoint > 0 && (status.level?.percent ?? 50) <= lowPoint;
  if (!status.valve.commanded) lowFill = false;
  if (status.valve.commanded && !manualUntil && !open) {
    if (veryLow) lowFill = true;
    if (!lowFill) setValve(false);
  }
  let p = status.level?.percent ?? 50;
  p += status.valve.commanded ? 0.6 : -0.08;
  p = Math.max(0, Math.min(100, p));
  if (status.valve.commanded && (p >= Number(config.stopFillPercent) || (manualUntil && now >= manualUntil))) {
    status.valve.commanded = false;
    status.valve.fillCount += 1;
    status.valve.lastFillS = Math.round((now - fillStartedAt) / 1000);
    manualUntil = 0;
    addEvent('FILL_COMPLETE');
  }
  status.level = { valid: true, percent: Math.round(p * 10) / 10, litres: Math.round((p / 100) * Number(config.usableCapacityLitres)), distanceCm: Math.round((145 - p * 1.1) * 10) / 10, ageMs: 200 };
  if (pausedUntil && (now >= pausedUntil || (open && !wasOpen && config.scheduleEnabled))) pausedUntil = 0;
  const wantsFill = !pausedUntil && !status.valve.commanded && status.mode === 'AUTO' && status.armed && p <= Number(config.startFillPercent);
  // A filling time that has just started tops the tank up once, if that is switched on.
  if (open && !wasOpen && config.scheduleEnabled && config.fillAtWindowStart) topUpPending = true;
  if (!open) topUpPending = false;
  wasOpen = open;
  const topUp = topUpPending && !pausedUntil && !status.valve.commanded && status.mode === 'AUTO' && status.armed && p <= Number(config.stopFillPercent) - 5;
  if (topUp) {
    topUpPending = false;
    setValve(true);
  }
  if (wantsFill && (open || veryLow)) {
    lowFill = !open;
    setValve(true);
  }
  const waiting = wantsFill && !open && !veryLow;
  const lowLevelFill = status.valve.commanded && lowFill;
  status = {
    ...status,
    tankName: String(config.tankName),
    updatedAt: now,
    uptimeS: Math.round((now - bootedAt) / 1000),
    phase: !status.armed ? 'DISARMED' : status.valve.commanded ? 'FILLING' : 'IDLE',
    schedule: config.scheduleEnabled ? { clockKnown: true, open, waiting, lowLevelFill } : undefined,
    warnings: [...(waiting ? ['WAITING_FOR_SUPPLY_WINDOW'] : lowLevelFill ? ['LOW_LEVEL_FILL'] : []), ...(pausedUntil ? ['AUTO_FILL_PAUSED'] : [])],
    valve: {
      ...status.valve,
      fillRuntimeS: status.valve.commanded ? Math.round((now - fillStartedAt) / 1000) : 0,
      manualRemainingS: status.valve.commanded && manualUntil ? Math.max(0, Math.round((manualUntil - now) / 1000)) : 0,
      manualMinutes: Number(config.manualOpenMinutes),
      pauseRemainingS: pausedUntil ? Math.max(1, Math.round((pausedUntil - now) / 1000)) : 0,
      openBlocker: blocker(),
    },
  };
  const lastSample = history[history.length - 1];
  if (!lastSample || now - lastSample.t >= 60_000) {
    history = [...history, { t: now, p: Math.round(p * 10) / 10, v: status.valve.commanded ? 1 : 0 }];
  }
  notify();
}

export function startDemo() {
  reset();
  active = true;
  if (!timer) timer = setInterval(tick, 2000);
}

export function stopDemo() {
  active = false;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Re-renders the caller whenever the simulated unit changes. */
function useDemoTick() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function useDemoDevice() {
  useDemoTick();
  return { status, config, online: true, connected: true, loading: false, error: null, serverNow: Date.now() };
}
export function useDemoEvents() {
  useDemoTick();
  return events;
}
export function useDemoHistory(hours: number) {
  useDemoTick();
  const from = Date.now() - hours * 3_600_000;
  return { points: history.filter((p) => p.t >= from), loading: false, error: null, reload: async () => {} };
}
export function useDemoLogbook() {
  useDemoTick();
  return logbook;
}
export function useDemoRecord() {
  useDemoTick();
  return {
    record,
    save: async (next: Record<string, string>) => {
      record = next;
      notify();
    },
  };
}

export async function demoCommand(command: { type: string; mode?: string; config?: DeviceConfig; pin?: string }) {
  await new Promise((r) => setTimeout(r, 600)); // feel like a round trip
  let reason: string | undefined;
  switch (command.type) {
    case 'close':
      setValve(false);
      if (status.mode === 'AUTO') status.mode = 'MANUAL';
      break;
    case 'open':
      if (status.mode === 'AUTO') reason = 'WRONG_MODE';
      else if (blocker() !== 'NONE') reason = blocker();
      else setValve(true, true);
      break;
    case 'valveOn':
      if (blocker() !== 'NONE') reason = blocker();
      else {
        pausedUntil = 0;
        setValve(true, true);
      }
      break;
    case 'valveOff':
      setValve(false);
      if (status.mode === 'AUTO') pausedUntil = Date.now() + 60_000; // the unit pauses for retryMinutes; the demo runs faster
      break;
    case 'ack':
      if (!status.armed) addEvent('ARMED');
      status.armed = true;
      break;
    case 'mute':
      status.muted = true;
      break;
    case 'setMode':
      setValve(false);
      status.mode = command.mode as DeviceStatus['mode'];
      addEvent('MODE_CHANGED', command.mode);
      break;
    case 'setConfig':
      if (command.pin !== DEMO_PIN) {
        reason = 'WRONG_PIN';
        break;
      }
      setValve(false);
      config = { ...config, ...command.config, revision: Number(config.revision) + 1 };
      addEvent('CONFIG_CHANGED');
      break;
    default:
      reason = 'UNKNOWN_COMMAND';
  }
  if (reason) addEvent('COMMAND_DENIED', reason);
  tick();
  return { ok: !reason, reason };
}

export async function demoAddLogbook(entry: { kind: string; checks: string[]; note: string }) {
  logbook = [{ id: `l${Date.now()}`, ...entry, by: 'demo', at: Date.now() }, ...logbook];
  notify();
}
export async function demoDeleteLogbook(id: string) {
  logbook = logbook.filter((e) => e.id !== id);
  notify();
}
