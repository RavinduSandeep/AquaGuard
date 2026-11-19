// The installation as a live picture: water line -> valve -> tank, with the
// two things that watch the level (ultrasonic sensor, float switch) and the
// controller. Tap a part to read what it is doing now.
//
// The moving water in the pipe follows the valve COMMAND. Without a flow
// sensor nothing here can prove that water is really flowing.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { formatDuration, type DeviceStatus } from '../logic';
import { Muted, useTheme } from '../ui';

type Part = 'line' | 'valve' | 'tank' | 'sensor' | 'float' | 'controller';
const PARTS: { id: Part; name: string }[] = [
  { id: 'line', name: 'Water line' },
  { id: 'valve', name: 'Valve' },
  { id: 'tank', name: 'Tank' },
  { id: 'sensor', name: 'Level sensor' },
  { id: 'float', name: 'Float switch' },
  { id: 'controller', name: 'Controller' },
];

// Drawing coordinates (viewBox 0 0 360 236).
const TANK = { x: 176, y: 58, w: 104, h: 164 };
const PIPE = 'M0 168 H62 M86 168 H128 V34 H200 V58';
const INNER = 4; // wall thickness
// Without this, text inside the drawing falls back to a serif face on the web.
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : undefined;

export function SystemDiagram({
  status,
  online,
  current,
  start,
  stop,
  low,
}: {
  status: DeviceStatus | null;
  online: boolean;
  current: boolean; // the level reading can be trusted right now
  start?: number;
  stop?: number;
  low?: number;
}) {
  const t = useTheme();
  const [part, setPart] = useState<Part>('tank');
  const [phase, setPhase] = useState(0);
  const [still, setStill] = useState(false);

  const open = Boolean(status?.valve.commanded) && online;
  const percent = Math.max(0, Math.min(100, status?.level?.percent ?? 0));
  const rawDistance = status?.level?.distanceCm;
  const distance = rawDistance === undefined ? undefined : Math.round(rawDistance * 10) / 10;
  const floatOk = status?.inputs.floatHealthy ?? true;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);
  // Dashes move along the pipe while the valve is commanded open.
  useEffect(() => {
    if (!open || still) return;
    const id = setInterval(() => setPhase((p) => (p + 3) % 24), 120);
    return () => clearInterval(id);
  }, [open, still]);

  const inner = { x: TANK.x + INNER, y: TANK.y + INNER, w: TANK.w - 2 * INNER, h: TANK.h - 2 * INNER };
  const waterH = (percent / 100) * inner.h;
  const surfaceY = inner.y + inner.h - waterH;
  const levelY = (value: number) => inner.y + inner.h - (value / 100) * inner.h;
  const sensorX = TANK.x + 62;

  const ring = (id: Part) => (part === id ? t.accent : 'transparent');
  const hit = (id: Part, x: number, y: number, w: number, h: number) => (
    <Rect x={x} y={y} width={w} height={h} rx={8} fill="transparent" stroke={ring(id)} strokeWidth={2} strokeDasharray="4 3" onPress={() => setPart(id)} />
  );
  const mark = (value: number | undefined, label: string) =>
    value === undefined ? null : (
      <G key={label}>
        <Line x1={TANK.x + TANK.w - 14} x2={TANK.x + TANK.w + 6} y1={levelY(value)} y2={levelY(value)} stroke={t.ink2} strokeWidth={1.5} />
        <SvgText fontFamily={FONT} x={TANK.x + TANK.w + 9} y={levelY(value) + 4} fill={t.ink2} fontSize={11}>
          {`${label} ${value}%`}
        </SvgText>
      </G>
    );

  const detail: Record<Part, { title: string; lines: string[] }> = {
    line: {
      title: 'Water line',
      lines: [
        'The supply pipe from the water board or pump. It is always under pressure up to the valve.',
        'AquaGuard does not measure it: the app cannot tell whether the supply is on.',
      ],
    },
    valve: {
      title: `Valve: ${!status ? 'unknown' : status.valve.commanded ? `commanded open for ${formatDuration(status.valve.fillRuntimeS)}` : 'closed'}`,
      lines: [
        'A normally closed solenoid valve: it shuts by itself when power is removed.',
        'The app shows the command only. Without a flow sensor the unit cannot prove water is flowing or has stopped.',
      ],
    },
    tank: {
      title: `Tank: ${current ? `${Math.round(percent)}%, about ${status?.level?.litres ?? '?'} L` : 'level unknown'}`,
      lines: [
        start !== undefined && stop !== undefined ? `Fills from ${start}% up to ${stop}%.` : 'Waiting for the unit to report its settings.',
        ...(low !== undefined ? [`At ${low}% or below it fills at any time, even outside the filling times.`] : []),
      ],
    },
    sensor: {
      title: `Level sensor: ${current && distance !== undefined ? `${distance} cm to the water` : 'no trusted reading'}`,
      lines: [
        'A waterproof ultrasonic sensor on the tank lid measures the distance down to the water. The unit turns that into a percentage.',
        status?.simulated ? 'This unit runs bench-test firmware: the reading is simulated.' : 'A missing or stale reading is never treated as an empty tank.',
      ],
    },
    float: {
      title: `Float switch: ${!status ? 'unknown' : floatOk ? 'healthy' : 'HIGH LEVEL or loop open'}`,
      lines: [
        'A float near the top of the tank. If the water reaches it, it cuts power to the valve through a relay, with no software involved.',
        'It is the backup that prevents an overflow if the level sensor is wrong.',
      ],
    },
    controller: {
      title: `Controller: ${online ? 'online' : 'offline'}${status ? `, ${status.armed ? 'armed' : 'disarmed'}, ${status.mode.toLowerCase()} mode` : ''}`,
      lines: [
        'The ESP32-S3 unit. It reads the sensor and the float, decides when to open the valve, and reports here over Wi-Fi.',
        'It keeps controlling the tank when the internet is down.',
      ],
    },
  };

  const summary = `Diagram: water line, valve ${open ? 'open' : 'closed'}, tank ${current ? `${Math.round(percent)} percent full` : 'level unknown'}, level sensor, float switch ${floatOk ? 'healthy' : 'tripped'}, controller ${online ? 'online' : 'offline'}.`;

  return (
    <View style={{ gap: 10 }}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ width: '100%', maxWidth: 460, alignSelf: 'center', aspectRatio: 360 / 236 }}>
        <Svg width="100%" height="100%" viewBox="0 0 360 236">
          {/* Controller and its signal wires */}
          <Path d={`M92 20 H${sensorX} V40`} stroke={t.ink2} strokeWidth={1} strokeDasharray="3 3" fill="none" />
          <Path d="M52 40 V70 H74 V152" stroke={t.ink2} strokeWidth={1} strokeDasharray="3 3" fill="none" />
          <Rect x={8} y={6} width={84} height={34} rx={6} fill={t.card} stroke={t.ink} strokeWidth={2} />
          <Circle cx={20} cy={23} r={4} fill={online ? t.ok : t.ink2} />
          <SvgText fontFamily={FONT} x={29} y={27} fill={t.ink} fontSize={11} fontWeight="700">
            Controller
          </SvgText>

          {/* Supply pipe, valve, pipe into the tank */}
          <Path d={PIPE} stroke={t.line} strokeWidth={10} fill="none" strokeLinejoin="round" />
          <Path d="M0 168 H62" stroke={t.water} strokeWidth={6} fill="none" />
          {open ? (
            <>
              <Path d="M86 168 H128 V34 H200 V58" stroke={t.water} strokeWidth={6} fill="none" strokeLinejoin="round" />
              <Path d="M86 168 H128 V34 H200 V58" stroke={t.card} strokeWidth={2} fill="none" strokeDasharray="6 18" strokeDashoffset={-phase} strokeLinejoin="round" />
            </>
          ) : null}
          <Path d="M60 156 L88 180 V156 L60 180 Z" fill={open ? t.water : t.card} stroke={t.ink} strokeWidth={2} strokeLinejoin="round" />
          <Line x1={74} x2={74} y1={168} y2={152} stroke={t.ink} strokeWidth={2} />
          <Rect x={66} y={144} width={16} height={9} rx={2} fill={t.card} stroke={t.ink} strokeWidth={2} />
          <SvgText fontFamily={FONT} x={2} y={156} fill={t.ink2} fontSize={11}>
            Water line
          </SvgText>
          <SvgText fontFamily={FONT} x={74} y={200} fill={t.ink} fontSize={11} fontWeight="700" textAnchor="middle">
            {open ? 'Valve open' : 'Valve closed'}
          </SvgText>
          {open ? (
            <SvgText fontFamily={FONT} x={74} y={213} fill={t.ink2} fontSize={10} textAnchor="middle">
              (commanded)
            </SvgText>
          ) : null}

          {/* Tank and water */}
          <Rect x={TANK.x} y={TANK.y} width={TANK.w} height={TANK.h} rx={10} fill={t.bg} stroke={t.ink} strokeWidth={3} />
          {waterH > 0 ? <Rect x={inner.x} y={surfaceY} width={inner.w} height={waterH} rx={5} fill={current ? t.water : t.line} /> : null}
          {open ? <Line x1={200} x2={200} y1={inner.y} y2={Math.max(inner.y, surfaceY)} stroke={t.water} strokeWidth={4} strokeDasharray="5 5" strokeDashoffset={-phase} /> : null}
          {mark(stop, 'stop')}
          {mark(start, 'start')}
          {mark(low, 'low')}

          {/* Ultrasonic level sensor: on the lid, looking down at the water */}
          <Rect x={sensorX - 12} y={40} width={24} height={14} rx={3} fill={t.card} stroke={t.ink} strokeWidth={2} />
          <Path d={`M${sensorX - 5} ${inner.y} L${sensorX - 12} ${surfaceY} M${sensorX + 5} ${inner.y} L${sensorX + 12} ${surfaceY}`} stroke={current ? t.ink2 : t.line} strokeWidth={1} strokeDasharray="3 3" fill="none" />
          <SvgText fontFamily={FONT} x={sensorX + 6} y={33} fill={t.ink2} fontSize={11}>
            {current && distance !== undefined ? `Sensor ${distance} cm` : 'Sensor'}
          </SvgText>

          {/* High-level float switch near the top of the tank */}
          <Line x1={inner.x + inner.w} x2={inner.x + inner.w - 14} y1={inner.y + 12} y2={inner.y + 16} stroke={t.ink} strokeWidth={2} />
          <Circle cx={inner.x + inner.w - 19} cy={inner.y + 18} r={6} fill={floatOk ? t.ok : t.bad} stroke={t.ink} strokeWidth={2} />
          <Line x1={inner.x + inner.w - 14} x2={TANK.x + TANK.w + 7} y1={inner.y + 13} y2={TANK.y - 6} stroke={t.ink2} strokeWidth={1} />
          <SvgText fontFamily={FONT} x={TANK.x + TANK.w + 9} y={TANK.y - 4} fill={floatOk ? t.ink2 : t.bad} fontSize={11} fontWeight={floatOk ? '400' : '700'}>
            {floatOk ? 'Float' : 'Float HIGH'}
          </SvgText>

          {/* Tap targets */}
          {hit('controller', 4, 2, 92, 42)}
          {hit('line', 0, 142, 56, 40)}
          {hit('valve', 54, 138, 40, 80)}
          {hit('tank', TANK.x - 5, TANK.y - 5, TANK.w + 10, TANK.h + 10)}
          {hit('sensor', sensorX - 18, 24, 100, 32)}
          {hit('float', inner.x + inner.w - 30, inner.y + 4, 30, 26)}
        </Svg>
      </View>

      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PARTS.map((p) => {
          const on = p.id === part;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setPart(p.id)}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 999, borderWidth: on ? 2 : 1, borderColor: on ? t.accent : t.line, backgroundColor: on ? t.waterWash : t.bg, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ color: t.ink, fontSize: 13, fontWeight: on ? '800' : '600' }}>{p.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 4, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, backgroundColor: t.bg }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800' }}>{detail[part].title}</Text>
        {detail[part].lines.map((line) => (
          <Muted key={line}>{line}</Muted>
        ))}
      </View>
    </View>
  );
}
