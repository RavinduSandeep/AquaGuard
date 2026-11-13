// Live data hooks and requests for one AquaGuard unit.
// Layout under /devices/<deviceId>/ is documented in docs/firebase-setup.md.
import {
  get,
  limitToLast,
  onValue,
  orderByKey,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from 'firebase/database';
import { useCallback, useEffect, useState } from 'react';

import {
  demoActive,
  demoAddLogbook,
  demoCommand,
  demoDeleteLogbook,
  useDemoDevice,
  useDemoEvents,
  useDemoHistory,
  useDemoLogbook,
  useDemoRecord,
} from './demo';
import { fb } from './firebase';
import {
  dayKeys,
  isOnline,
  parseDay,
  type DeviceConfig,
  type DeviceEvent,
  type DeviceStatus,
  type HistoryPoint,
} from './logic';

const path = (deviceId: string, child: string) => ref(fb().db, `devices/${deviceId}/${child}`);

/** Phone clocks drift; Firebase reports the offset to its own clock. */
function useServerNow(): number {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => onValue(ref(fb().db, '.info/serverTimeOffset'), (s) => setOffset(Number(s.val()) || 0)), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);
  return now + offset;
}

export type Live = {
  status: DeviceStatus | null;
  config: DeviceConfig | null;
  online: boolean;
  connected: boolean; // this phone's link to Firebase
  loading: boolean;
  error: string | null;
  serverNow: number;
};

// Demo mode is fixed while the main screens are mounted, so picking the hook
// implementation here keeps the order of hooks stable.
export function useDevice(deviceId: string): Live {
  return demoActive() ? useDemoDevice() : useLiveDevice(deviceId);
}

function useLiveDevice(deviceId: string): Live {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serverNow = useServerNow();

  useEffect(() => {
    setStatus(null);
    setConfig(null);
    setLoading(true);
    setError(null);
    const fail = (e: Error) => {
      setLoading(false);
      setError(
        /permission/i.test(e.message)
          ? 'This account is not a member of that unit. Check the Device ID and the members entry in Firebase.'
          : e.message,
      );
    };
    const stops = [
      onValue(
        path(deviceId, 'status'),
        (s) => {
          setStatus(s.val());
          setLoading(false);
        },
        fail,
      ),
      onValue(path(deviceId, 'config'), (s) => setConfig(s.val()), () => {}),
      onValue(ref(fb().db, '.info/connected'), (s) => setConnected(Boolean(s.val()))),
    ];
    return () => stops.forEach((stop) => stop());
  }, [deviceId]);

  return { status, config, online: connected && isOnline(status, serverNow), connected, loading, error, serverNow };
}

export function useEvents(deviceId: string, count = 60): DeviceEvent[] {
  return demoActive() ? useDemoEvents() : useLiveEvents(deviceId, count);
}

function useLiveEvents(deviceId: string, count: number): DeviceEvent[] {
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  useEffect(() => {
    const q = query(path(deviceId, 'events'), orderByKey(), limitToLast(count));
    return onValue(
      q,
      (snap) => {
        const list: DeviceEvent[] = [];
        snap.forEach((child) => {
          list.push({ id: child.key!, ...child.val() });
        });
        setEvents(list.reverse());
      },
      () => setEvents([]),
    );
  }, [deviceId, count]);
  return events;
}

export function useHistory(deviceId: string, hours: number) {
  return demoActive() ? useDemoHistory(hours) : useLiveHistory(deviceId, hours);
}

function useLiveHistory(deviceId: string, hours: number) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = Date.now();
      const keys = dayKeys(now, hours);
      const days = await Promise.all(keys.map((k) => get(path(deviceId, `history/${k}`))));
      const from = now - hours * 3_600_000;
      setPoints(days.flatMap((snap, i) => parseDay(keys[i], snap.val())).filter((p) => p.t >= from));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  }, [deviceId, hours]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60_000); // the unit adds a sample every 5 minutes
    return () => clearInterval(timer);
  }, [load]);

  return { points, loading, error, reload: load };
}

// ---------------------------------------------------------------- requests

export type CommandResult = { ok: boolean; reason?: string };
export type Command =
  | { type: 'close' | 'open' | 'ack' | 'mute' }
  | { type: 'setMode'; mode: 'AUTO' | 'MANUAL' | 'MAINTENANCE' }
  | { type: 'setConfig'; config: DeviceConfig };

/**
 * Writes a request for the unit and waits for its answer. The unit decides:
 * every request goes through its safety manager and may be refused. Requests
 * older than 60 s are discarded by the unit, so nothing ever runs late.
 */
export async function sendCommand(deviceId: string, command: Command, timeoutMs = 15_000): Promise<CommandResult> {
  if (demoActive()) return demoCommand(command);
  const { auth } = fb();
  const request = push(path(deviceId, 'commands'));
  const answer = path(deviceId, `results/${request.key}`);
  await set(request, { ...command, ts: serverTimestamp(), uid: auth.currentUser?.uid ?? '' });

  return new Promise<CommandResult>((resolve) => {
    let done = false;
    const finish = (result: CommandResult, answered: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      if (answered) remove(answer).catch(() => {});
      else remove(request).catch(() => {}); // withdraw a request nobody picked up
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'NO_ANSWER' }, false), timeoutMs);
    const stop = onValue(
      answer,
      (snap) => {
        const v = snap.val();
        if (v) finish({ ok: Boolean(v.ok), reason: v.reason }, true);
      },
      () => finish({ ok: false, reason: 'NO_ANSWER' }, false),
    );
  });
}

// ----------------------------------------------------------------- logbook

export type LogbookEntry = {
  id: string;
  kind: string;
  checks?: string[];
  note?: string;
  by?: string;
  at?: number;
};

export function useLogbook(deviceId: string): LogbookEntry[] {
  return demoActive() ? useDemoLogbook() : useLiveLogbook(deviceId);
}

function useLiveLogbook(deviceId: string): LogbookEntry[] {
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  useEffect(() => {
    const q = query(path(deviceId, 'logbook'), orderByKey(), limitToLast(100));
    return onValue(
      q,
      (snap) => {
        const list: LogbookEntry[] = [];
        snap.forEach((child) => {
          list.push({ id: child.key!, ...child.val() });
        });
        setEntries(list.reverse());
      },
      () => setEntries([]),
    );
  }, [deviceId]);
  return entries;
}

export async function addLogbookEntry(deviceId: string, entry: { kind: string; checks: string[]; note: string }) {
  if (demoActive()) return demoAddLogbook(entry);
  const { auth } = fb();
  await set(push(path(deviceId, 'logbook')), {
    ...entry,
    by: auth.currentUser?.email ?? '',
    at: serverTimestamp(),
  });
}

export async function deleteLogbookEntry(deviceId: string, id: string) {
  if (demoActive()) return demoDeleteLogbook(id);
  await remove(path(deviceId, `logbook/${id}`));
}

/** The installed-configuration record of guide section 18. */
export function useRecord(deviceId: string) {
  return demoActive() ? useDemoRecord() : useLiveRecord(deviceId);
}

function useLiveRecord(deviceId: string) {
  const [record, setRecord] = useState<Record<string, string>>({});
  useEffect(() => onValue(path(deviceId, 'record'), (s) => setRecord(s.val() ?? {}), () => {}), [deviceId]);
  const save = useCallback((next: Record<string, string>) => set(path(deviceId, 'record'), next), [deviceId]);
  return { record, save };
}
