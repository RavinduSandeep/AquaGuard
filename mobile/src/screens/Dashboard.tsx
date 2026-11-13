import { ScrollView, Text, View } from 'react-native';

import { type Live } from '../data';
import { formatDuration, headline, humanize, levelIsCurrent } from '../logic';
import { Card, Muted, Notice, Row, styles, useTheme } from '../ui';

function Tank({ percent, current }: { percent: number; current: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{ width: 96, height: 168, borderWidth: 3, borderColor: t.ink, borderRadius: 12, overflow: 'hidden', justifyContent: 'flex-end' }}
      accessibilityLabel={current ? `Tank ${Math.round(percent)} percent full` : 'Tank level unknown'}
    >
      <View style={{ height: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: current ? t.water : t.line }} />
    </View>
  );
}

export function Dashboard({ live }: { live: Live }) {
  const t = useTheme();
  const { status, online, serverNow } = live;
  const current = levelIsCurrent(status, online);
  const level = status?.level;
  const head = headline(status, online);
  const lastSeen = status?.updatedAt ? formatDuration((serverNow - status.updatedAt) / 1000) : null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
          <Tank percent={level?.percent ?? 0} current={current} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: t.ink, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 70 }}>
              {current ? `${Math.round(level!.percent!)}%` : '--%'}
            </Text>
            <Text style={{ color: t.ink2, fontSize: 15 }}>
              {current ? `about ${level!.litres} L (estimate)` : 'Current level unknown'}
            </Text>
            {!current && level?.percent !== undefined ? (
              <Text style={{ color: t.ink2, fontSize: 13 }}>
                Last trusted reading: {Math.round(level.percent)}%
              </Text>
            ) : null}
          </View>
        </View>
        <Notice tone={head.tone} text={head.text} />
        {status && !online && lastSeen ? <Muted>Last report {lastSeen} ago. Local automatic control and the hardware interlock keep working without internet.</Muted> : null}
      </Card>

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

          <Card title="Control">
            <Row label="Mode" value={status.mode} />
            <Row label="State" value={humanize(status.phase)} />
            <Row
              label="Valve (commanded)"
              value={status.valve.commanded ? `OPEN for ${formatDuration(status.valve.fillRuntimeS)}` : 'CLOSED'}
              tone={status.valve.commanded ? 'info' : undefined}
            />
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
