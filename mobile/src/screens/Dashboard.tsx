import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { sendCommand, type Live } from '../data';
import { DAY_NAMES, describeWindow, formatDuration, groupDays, headline, humanize, levelIsCurrent, scheduleFromConfig, unitClock } from '../logic';
import { Button, Card, Chip, Muted, Notice, Row, styles, useTheme } from '../ui';
import { SystemDiagram } from './SystemDiagram';

/**
 * Valve on and off, straight from the first screen. They work in every mode
 * and leave the mode and the filling times as they are. The unit still
 * decides: every interlock, the stop level and the time limit stay active.
 */
function ValveButtons({ deviceId, live }: { deviceId: string; live: Live }) {
  const { status, online } = live;
  const [busy, setBusy] = useState<'on' | 'off' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!status) return null;

  const open = status.valve.commanded;
  const minutes = status.valve.manualMinutes;
  const paused = status.valve.pauseRemainingS ?? 0;
  const blocker = status.valve.openBlocker;
  const send = async (key: 'on' | 'off') => {
    setBusy(key);
    setResult(null);
    try {
      const r = await sendCommand(deviceId, { type: key === 'on' ? 'valveOn' : 'valveOff' });
      setResult({ ok: r.ok, text: r.ok ? (key === 'on' ? 'Valve commanded on' : 'Valve commanded off') : `Refused: ${humanize(r.reason)}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not send the request' });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  return (
    <Card title="Valve">
      <Row
        label="Now"
        value={open ? (status.valve.manualRemainingS ? `On, turns off in ${formatDuration(status.valve.manualRemainingS)}` : `On for ${formatDuration(status.valve.fillRuntimeS)}`) : 'Off'}
        tone={open ? 'info' : undefined}
      />
      {paused ? <Row label="Automatic filling paused for" value={formatDuration(paused)} tone="warn" /> : null}
      {!open && blocker !== 'NONE' && online ? <Row label="On would be refused" value={humanize(blocker)} tone="warn" /> : null}
      {confirm ? (
        <View style={styles.wrap}>
          <Button kind="primary" label={minutes ? `Yes, on for up to ${minutes} min` : 'Yes, turn the valve on'} busy={busy === 'on'} disabled={!online} onPress={() => send('on')} style={{ flexGrow: 1 }} />
          <Button label="Cancel" disabled={busy !== null} onPress={() => setConfirm(false)} style={{ flexGrow: 1 }} />
        </View>
      ) : (
        <View style={styles.wrap}>
          <Button kind="primary" label="Valve on…" disabled={!online || open || busy !== null} onPress={() => setConfirm(true)} style={{ flexGrow: 1 }} />
          <Button kind="danger" label="Valve off" busy={busy === 'off'} disabled={!online || (busy !== null && busy !== 'off')} onPress={() => send('off')} style={{ flexGrow: 1 }} />
        </View>
      )}
      {result ? <Notice tone={result.ok ? 'ok' : 'bad'} text={result.text} /> : null}
      <Muted>
        {`Works in any mode and outside the filling times; the mode and your filling times stay as they are. On closes by itself${minutes ? ` after ${minutes} min` : ''} or at the stop level, and the float, emergency stop and sensor checks stay active. Off in Auto pauses automatic filling for a while, until the next filling time at the latest.`}
      </Muted>
    </Card>
  );
}

export function Dashboard({ deviceId, live, onOpenControl }: { deviceId: string; live: Live; onOpenControl?: () => void }) {
  const t = useTheme();
  const { status, config, online, serverNow } = live;
  const current = levelIsCurrent(status, online);
  const level = status?.level;
  const head = headline(status, online, serverNow);
  const lastSeen = status?.updatedAt ? formatDuration((serverNow - status.updatedAt) / 1000) : null;
  const start = config?.startFillPercent !== undefined ? Number(config.startFillPercent) : undefined;
  const stop = config?.stopFillPercent !== undefined ? Number(config.stopFillPercent) : undefined;

  const schedule = scheduleFromConfig(config);
  const clock = unitClock(serverNow, Number(config?.utcOffsetMinutes ?? 330));
  const today = schedule?.days[clock.dayOfWeek];
  const todayWindow = today ? (today.on ? describeWindow(today.start, today.end) : 'No filling today') : null;
  // The low mark only means something while the filling times are on.
  const low = schedule?.enabled && schedule.lowLevel > 0 ? schedule.lowLevel : undefined;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12 }}>
          <Text style={{ color: t.ink, fontSize: 60, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 66 }}>
            {current ? `${Math.round(level!.percent!)}%` : '--%'}
          </Text>
          <View style={{ gap: 2, paddingBottom: 6 }}>
            <Text style={{ color: t.ink2, fontSize: 15 }}>
              {current ? `about ${level!.litres} L (estimate)` : 'Current level unknown'}
            </Text>
            {!current && level?.percent !== undefined ? (
              <Text style={{ color: t.ink2, fontSize: 13 }}>Last trusted reading: {Math.round(level.percent)}%</Text>
            ) : null}
          </View>
        </View>
        <Notice tone={head.tone} text={head.text} />
        <SystemDiagram status={status} online={online} current={current} start={start} stop={stop} low={low} />
        {status && online ? (
          <View style={styles.wrap}>
            <Chip tone={status.valve.commanded ? 'info' : 'muted'} label={status.valve.commanded ? 'Valve open (commanded)' : 'Valve closed'} />
            <Chip tone={status.mode === 'AUTO' ? 'ok' : 'warn'} label={`${status.mode.charAt(0)}${status.mode.slice(1).toLowerCase()} mode`} />
            <Chip tone={status.armed ? 'ok' : 'warn'} label={status.armed ? 'Armed' : 'Disarmed'} />
          </View>
        ) : null}
        {status?.simulated ? (
          <Notice tone="warn" text="Bench-test firmware: the level and inputs are simulated and the valve output is disabled" />
        ) : null}
        {status && !online && lastSeen ? <Muted>Last report {lastSeen} ago. Local automatic control and the hardware interlock keep working without internet.</Muted> : null}
      </Card>

      <ValveButtons deviceId={deviceId} live={live} />

      {status ? (
        <>
          {(status.warnings ?? []).length && online ? (
            <Card title="Warnings">
              {(status.warnings ?? []).map((w) => (
                <Text key={w} style={{ color: t.warn, fontWeight: '600' }}>
                  {humanize(w)}
                </Text>
              ))}
            </Card>
          ) : null}

          {schedule ? (
            <Card title="Filling times">
              {schedule.enabled ? (
                <>
                  <Row label={`Today (${DAY_NAMES[clock.dayOfWeek]})`} value={todayWindow ?? ''} />
                  {status.schedule && online ? (
                    <Row
                      label="Right now"
                      value={!status.schedule.clockKnown ? 'No clock time: not applied' : status.schedule.lowLevelFill ? 'Very low: filling now' : status.schedule.waiting ? 'Low: waiting for the next time' : status.schedule.open ? 'Inside a filling time' : 'Outside the filling times'}
                      tone={!status.schedule.clockKnown ? 'warn' : status.schedule.lowLevelFill || status.schedule.waiting ? 'info' : status.schedule.open ? 'ok' : undefined}
                    />
                  ) : null}
                  {groupDays(schedule).length > 1
                    ? groupDays(schedule).map((g) => (
                        <Row key={g.label} label={g.label} value={g.window.on ? describeWindow(g.window.start, g.window.end) : 'No filling'} />
                      ))
                    : null}
                  <Row label="Very low tank" value={low ? `Fills at any time at ${low}%` : 'Waits for the filling time'} />
                </>
              ) : (
                <Muted>Off: the unit fills at any time the level drops to the start point.</Muted>
              )}
              {onOpenControl ? <Button label="Change filling times" onPress={onOpenControl} /> : null}
            </Card>
          ) : null}

          <Card title="Filling">
            <Row
              label="Valve (commanded)"
              value={status.valve.commanded ? `Open for ${formatDuration(status.valve.fillRuntimeS)}` : 'Closed'}
              tone={status.valve.commanded ? 'info' : undefined}
            />
            <Row label="State" value={humanize(status.phase)} />
            {start !== undefined && stop !== undefined ? <Row label="Fills from / to" value={`${start}% / ${stop}%`} /> : null}
            <Row label="Opening blocked by" value={humanize(status.valve.openBlocker)} />
            <Row label="Fills since power-up" value={String(status.valve.fillCount)} />
            {status.valve.lastFillS ? <Row label="Last fill took" value={formatDuration(status.valve.lastFillS)} /> : null}
            <Muted>
              The valve line is the command only. Without a flow sensor the unit cannot prove the valve physically opened or sealed.
            </Muted>
          </Card>

          <Card title="Safety interlocks">
            <Row
              label="High-level float loop"
              value={status.inputs.floatHealthy ? 'Healthy' : 'HIGH LEVEL or loop open'}
              tone={status.inputs.floatHealthy ? 'ok' : 'bad'}
            />
            <Row
              label="Emergency stop"
              value={status.inputs.estopHealthy ? 'Healthy' : 'PRESSED or wire open'}
              tone={status.inputs.estopHealthy ? 'ok' : 'bad'}
            />
            <Row
              label="Relay K1"
              value={status.inputs.k1Enabled ? 'Energised' : 'Dropped out'}
              tone={status.inputs.k1Enabled ? 'ok' : 'bad'}
            />
          </Card>

          <Card title="Measurement">
            <Row label="Distance to water" value={level?.distanceCm !== undefined ? `${level.distanceCm} cm` : 'Unknown'} />
            <Row
              label="Reading age at the unit"
              value={level?.ageMs !== undefined ? `${(level.ageMs / 1000).toFixed(1)} s` : 'No trusted reading'}
              tone={level?.valid ? undefined : 'warn'}
            />
            <Row label="Unit Wi-Fi signal" value={status.wifi?.connected ? `${status.wifi.rssi} dBm` : 'Unknown'} />
            <Row label="Unit running for" value={formatDuration(status.uptimeS)} />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
