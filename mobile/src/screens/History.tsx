import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useEvents, useHistory, type Live } from '../data';
import { LevelChart } from '../LevelChart';
import { humanize, summarize } from '../logic';
import { Button, Card, Muted, Row, styles, useTheme } from '../ui';

const RANGES = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
];

function eventTime(e: { at?: number; ts?: number; uptimeS?: number }): string {
  const ms = e.at ?? (e.ts ? e.ts * 1000 : 0);
  if (!ms) return `up ${e.uptimeS ?? 0} s`;
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function History({ deviceId, live }: { deviceId: string; live: Live }) {
  const t = useTheme();
  const [hours, setHours] = useState(24);
  const [table, setTable] = useState(false);
  const { points, loading, error, reload } = useHistory(deviceId, hours);
  const events = useEvents(deviceId);
  const stats = summarize(points);
  const cfg = live.config;

  // Table view: roughly one row per hour, newest first.
  const step = Math.max(1, Math.round(points.length / (hours > 48 ? 56 : 24)));
  const rows = points.filter((_, i) => (points.length - 1 - i) % step === 0).reverse();

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.wrap}>
        {RANGES.map((r) => (
          <Button key={r.hours} label={r.label} kind={r.hours === hours ? 'primary' : 'plain'} onPress={() => setHours(r.hours)} style={{ flexGrow: 1 }} />
        ))}
      </View>

      <Card title={`Tank level, last ${RANGES.find((r) => r.hours === hours)!.label}`}>
        <LevelChart
          points={points}
          hours={hours}
          now={Date.now()}
          startPercent={typeof cfg?.startFillPercent === 'number' ? cfg.startFillPercent : undefined}
          stopPercent={typeof cfg?.stopFillPercent === 'number' ? cfg.stopFillPercent : undefined}
        />
        {error ? <Text style={{ color: t.bad }}>{error}</Text> : null}
        <Muted>Touch and drag on the chart to read a sample. Gaps mean the unit was offline or had no trusted reading. One sample every 5 minutes, kept for 30 days.</Muted>
        <View style={styles.wrap}>
          <Button label={loading ? 'Loading…' : 'Refresh'} onPress={reload} disabled={loading} />
          <Button label={table ? 'Hide table' : 'Show as table'} onPress={() => setTable(!table)} />
        </View>
      </Card>

      {stats ? (
        <Card title="In this period">
          <Row label="Lowest" value={`${stats.min.p.toFixed(1)}%`} />
          <Row label="Highest" value={`${stats.max.p.toFixed(1)}%`} />
          <Row label="Fills started" value={String(stats.fills)} />
        </Card>
      ) : null}

      {table ? (
        <Card title="Samples">
          {rows.length ? (
            rows.map((p) => (
              <Row
                key={p.t}
                label={new Date(p.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                value={`${p.p.toFixed(1)}%${p.v ? ' · valve open' : ''}`}
              />
            ))
          ) : (
            <Muted>No samples.</Muted>
          )}
        </Card>
      ) : null}

      <Card title="Events">
        {events.length ? (
          events.map((e) => (
            <Row key={e.id} label={eventTime(e)} value={humanize(e.event) + (e.detail && e.detail !== 'NONE' ? `: ${humanize(e.detail)}` : '')} />
          ))
        ) : (
          <Muted>No events recorded yet.</Muted>
        )}
      </Card>
    </ScrollView>
  );
}
