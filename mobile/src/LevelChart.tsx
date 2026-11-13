// Tank level over time: one series on one 0-100 % axis. Shaded bands mark the
// periods the valve was commanded open. Touch and drag to read a sample.
import { useMemo, useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { splitAtGaps, type HistoryPoint } from './logic';
import { useTheme } from './ui';

const HEIGHT = 220;
const M = { left: 30, right: 46, top: 12, bottom: 24 };
const Y_TICKS = [0, 25, 50, 75, 100];

function timeLabel(t: number, spanHours: number): string {
  const d = new Date(t);
  if (spanHours > 48) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function LevelChart({
  points,
  hours,
  now,
  startPercent,
  stopPercent,
}: {
  points: HistoryPoint[];
  hours: number;
  now: number;
  startPercent?: number;
  stopPercent?: number;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<HistoryPoint | null>(null);

  const t0 = now - hours * 3_600_000;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (time: number) => M.left + ((time - t0) / (now - t0)) * plotW;
  const y = (percent: number) => M.top + (1 - percent / 100) * plotH;

  const { lines, areas, bands } = useMemo(() => {
    const runs = splitAtGaps(points);
    const lines: string[] = [];
    const areas: string[] = [];
    const bands: { x: number; w: number }[] = [];
    for (const run of runs) {
      const d = run.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join('');
      lines.push(d);
      if (run.length > 1) {
        areas.push(`${d}L${x(run[run.length - 1].t).toFixed(1)},${y(0)}L${x(run[0].t).toFixed(1)},${y(0)}Z`);
      }
      for (let i = 0; i < run.length - 1; i++) {
        if (run[i].v) bands.push({ x: x(run[i].t), w: x(run[i + 1].t) - x(run[i].t) });
      }
    }
    return { lines, areas, bands };
    // x and y depend only on the values listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, hours, now]);

  const last = points[points.length - 1];
  const shown = picked ?? last ?? null;

  const pick = (e: GestureResponderEvent) => {
    if (!points.length || plotW <= 0) return;
    const time = t0 + ((e.nativeEvent.locationX - M.left) / plotW) * (now - t0);
    let best = points[0];
    for (const p of points) if (Math.abs(p.t - time) < Math.abs(best.t - time)) best = p;
    setPicked(best);
  };

  const xTicks = [0, 1, 2, 3].map((i) => t0 + ((now - t0) * i) / 3);

  return (
    <View>
      {/* Readout: the latest sample, or the one under the finger. */}
      <View style={{ minHeight: 40 }}>
        {shown ? (
          <>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {shown.p.toFixed(1)}%
              <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '400' }}>
                {'  '}
                {new Date(shown.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {shown.v ? ' · valve commanded open' : ''}
                {picked ? '' : ' · latest'}
              </Text>
            </Text>
          </>
        ) : (
          <Text style={{ color: t.ink2 }}>No samples in this period yet.</Text>
        )}
      </View>

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderRelease={() => setPicked(null)}
        onResponderTerminate={() => setPicked(null)}
        accessibilityLabel={
          last ? `Level chart for the last ${hours} hours. Latest ${last.p.toFixed(0)} percent.` : 'Level chart, no data'
        }
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {Y_TICKS.map((v) => (
              <Line key={v} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} stroke={t.line} strokeWidth={1} />
            ))}
            {Y_TICKS.map((v) => (
              <SvgText key={`l${v}`} x={M.left - 6} y={y(v) + 4} fontSize={11} fill={t.ink2} textAnchor="end">
                {v}
              </SvgText>
            ))}
            {xTicks.map((time, i) => (
              <SvgText
                key={i}
                x={x(time)}
                y={HEIGHT - 6}
                fontSize={11}
                fill={t.ink2}
                textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}
              >
                {i === 3 ? 'now' : timeLabel(time, hours)}
              </SvgText>
            ))}

            {bands.map((b, i) => (
              <Rect key={i} x={b.x} y={M.top} width={Math.max(1, b.w)} height={plotH} fill={t.fillBand} />
            ))}

            {/* Start and stop thresholds, labelled at the right edge. */}
            {[startPercent, stopPercent].map((v, i) =>
              v === undefined ? null : (
                <Line key={`th${i}`} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} stroke={t.ink2} strokeWidth={1} />
              ),
            )}
            {startPercent !== undefined ? (
              <SvgText x={M.left + plotW + 5} y={y(startPercent) + 4} fontSize={10} fill={t.ink2}>
                start
              </SvgText>
            ) : null}
            {stopPercent !== undefined ? (
              <SvgText x={M.left + plotW + 5} y={y(stopPercent) + 4} fontSize={10} fill={t.ink2}>
                stop
              </SvgText>
            ) : null}

            {areas.map((d, i) => (
              <Path key={`a${i}`} d={d} fill={t.waterWash} />
            ))}
            {lines.map((d, i) => (
              <Path key={`p${i}`} d={d} stroke={t.water} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {picked ? (
              <Line x1={x(picked.t)} x2={x(picked.t)} y1={M.top} y2={M.top + plotH} stroke={t.ink2} strokeWidth={1} />
            ) : null}
            {shown ? (
              <Circle cx={x(shown.t)} cy={y(shown.p)} r={5} fill={t.water} stroke={t.card} strokeWidth={2} />
            ) : null}
          </Svg>
        ) : (
          <View style={{ height: HEIGHT }} />
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 16, height: 2, backgroundColor: t.water }} />
          <Text style={{ color: t.ink2, fontSize: 12 }}>Level (%)</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, backgroundColor: t.fillBand, borderWidth: 1, borderColor: t.line }} />
          <Text style={{ color: t.ink2, fontSize: 12 }}>Valve commanded open</Text>
        </View>
      </View>
    </View>
  );
}
