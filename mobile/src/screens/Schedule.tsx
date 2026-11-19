// Filling times: the hours when the water supply is on, set for each day of
// the week. The unit only starts an automatic fill inside them, except when
// the tank is very low (low-level fill). Saving needs the settings PIN.
import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { type Live } from '../data';
import {
  copyDay,
  DAY_NAMES,
  DEFAULT_LOW_LEVEL,
  describeWindow,
  formatClock,
  formatUtcOffset,
  scheduleFromConfig,
  schedulePatch,
  stepClock,
  unitClock,
  WEEK_ORDER,
  windowSegments,
  type DayWindow,
  type Schedule,
} from '../logic';
import { useSettingsSave } from '../pin';
import { Button, Card, Chip, Muted, Notice, Row, useTheme } from '../ui';

/** One day as a bar, midnight to midnight, with the filling time shaded. */
function DayBar({ start, end, nowMinute }: { start: number; end: number; nowMinute?: number }) {
  const t = useTheme();
  return (
    <View accessibilityLabel={`Filling time ${describeWindow(start, end)}`}>
      <View style={{ height: 16, borderRadius: 8, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>
        {windowSegments(start, end).map((s) => (
          <View key={s.from} style={{ position: 'absolute', top: 0, bottom: 0, left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%`, backgroundColor: t.water }} />
        ))}
        {nowMinute !== undefined ? (
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${(nowMinute / 1440) * 100}%`, width: 2, backgroundColor: t.ink }} />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        {['12 am', '6 am', '12 pm', '6 pm', '12 am'].map((label, i) => (
          <Text key={i} style={{ color: t.ink2, fontSize: 11 }}>{label}</Text>
        ))}
      </View>
    </View>
  );
}

function StepButton({ label, hint, onPress, disabled }: { label: string; hint: string; onPress: () => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minWidth: 46, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}
    >
      <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function TimeStepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  const t = useTheme();
  const step = (delta: number) => onChange(stepClock(value, delta));
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink2, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <StepButton label="−1 h" hint={`${label}: one hour earlier`} onPress={() => step(-60)} disabled={disabled} />
        <StepButton label="−15" hint={`${label}: 15 minutes earlier`} onPress={() => step(-15)} disabled={disabled} />
        <Text style={{ flex: 1, textAlign: 'center', color: t.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatClock(value)}</Text>
        <StepButton label="+15" hint={`${label}: 15 minutes later`} onPress={() => step(15)} disabled={disabled} />
        <StepButton label="+1 h" hint={`${label}: one hour later`} onPress={() => step(60)} disabled={disabled} />
      </View>
    </View>
  );
}

/** The whole week at a glance. Tap a day to edit it below. */
function WeekList({ days, selected, today, nowMinute, onSelect }: { days: DayWindow[]; selected: number; today: number; nowMinute: number; onSelect: (d: number) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
      {WEEK_ORDER.map((d) => {
        const day = days[d];
        const on = d === selected;
        const text = !day.on ? 'No filling' : day.start === day.end ? 'Times are the same' : `${formatClock(day.start)} to ${formatClock(day.end)}`;
        return (
          <Pressable
            key={d}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${DAY_NAMES[d]}${d === today ? ', today' : ''}: ${text}`}
            onPress={() => onSelect(d)}
            style={({ pressed }) => ({
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              borderWidth: on ? 2 : 1,
              borderColor: on ? t.accent : t.line,
              backgroundColor: on ? t.waterWash : t.bg,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ width: 44 }}>
              <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800' }}>{DAY_NAMES[d].slice(0, 3)}</Text>
              {d === today ? <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700' }}>Today</Text> : null}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>
                {day.on
                  ? windowSegments(day.start, day.end).map((seg) => (
                      <View key={seg.from} style={{ position: 'absolute', top: 0, bottom: 0, left: `${seg.from * 100}%`, width: `${(seg.to - seg.from) * 100}%`, backgroundColor: t.water }} />
                    ))
                  : null}
                {d === today ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${(nowMinute / 1440) * 100}%`, width: 2, backgroundColor: t.ink }} /> : null}
              </View>
              <Text style={{ color: day.on ? t.ink : t.ink2, fontSize: 13, fontWeight: day.on ? '600' : '400', fontVariant: ['tabular-nums'] }}>{text}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function SwitchRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function FillingTimes({ deviceId, live }: { deviceId: string; live: Live }) {
  const t = useTheme();
  const { config, status, online, serverNow } = live;
  const current = scheduleFromConfig(config);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [revision, setRevision] = useState<unknown>(null);
  const [useLocalZone, setUseLocalZone] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const saver = useSettingsSave(deviceId, 'Filling times saved on the unit');

  // Load from the unit, and reload whenever the unit reports a change.
  useEffect(() => {
    if (config && current && config.revision !== revision) {
      setDraft(current);
      setRevision(config.revision);
      setUseLocalZone(false);
    }
  }, [config, current, revision]);

  if (!config) {
    return (
      <Card title="Filling times">
        <Muted>Waiting for the unit to report its settings.</Muted>
      </Card>
    );
  }
  if (!current || !draft) {
    return (
      <Card title="Filling times">
        <Muted>This unit's firmware does not have a filling time for each day yet. Update it to version 0.6.0 or later.</Muted>
      </Card>
    );
  }

  const remote = status?.remoteControl ?? false;
  const canEdit = online && remote && !saver.busy;
  const unitOffset = Number(config.utcOffsetMinutes ?? 330);
  const phoneOffset = -new Date().getTimezoneOffset();
  const clock = unitClock(serverNow, unitOffset);
  const day = selected ?? clock.dayOfWeek;
  const window = draft.days[day];
  const startPoint = Number(config.startFillPercent ?? 35);

  const built = schedulePatch(config, draft);
  const patch = built.patch ? { ...built.patch, ...(useLocalZone ? { utcOffsetMinutes: phoneOffset } : {}) } : null;
  const changed = patch ? Object.keys(patch).length : 0;
  const set = (part: Partial<Schedule>) => setDraft({ ...draft, ...part });
  const setDay = (part: Partial<DayWindow>) => set({ days: draft.days.map((w, d) => (d === day ? { ...w, ...part } : w)) });
  const same = (to: number[]) => to.every((d) => draft.days[d].on === window.on && draft.days[d].start === window.start && draft.days[d].end === window.end);
  const live_ = status?.schedule;

  // Low level: whole steps of 5 %, always below the start point.
  const lowMax = Math.max(5, Math.ceil(startPoint / 5) * 5 - 5);
  const lowOn = draft.lowLevel > 0;
  const stepLow = (delta: number) => set({ lowLevel: Math.max(5, Math.min(lowMax, Math.round(draft.lowLevel / 5) * 5 + delta)) });

  return (
    <>
      <Card title="Filling times">
        <SwitchRow label="Fill only when the supply is on" value={draft.enabled} disabled={!canEdit} onChange={(v) => set({ enabled: v })} />
        <Muted>
          {draft.enabled
            ? 'The unit starts an automatic fill only inside the time set for each day.'
            : 'Off: the unit fills at any time the level drops to the start point.'}
        </Muted>

        {current.enabled && live_ && online ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {!live_.clockKnown ? (
              <Chip tone="warn" label="Unit has no clock time: times not applied" />
            ) : live_.lowLevelFill ? (
              <Chip tone="info" label="Tank was very low: filling now" />
            ) : live_.waiting ? (
              <Chip tone="info" label="Tank is low: waiting for the next filling time" />
            ) : (
              <Chip tone={live_.open ? 'ok' : 'muted'} label={live_.open ? 'Inside a filling time now' : 'Outside the filling times now'} />
            )}
          </View>
        ) : null}

        {draft.enabled ? (
          <>
            <Muted>Tap a day to change it.</Muted>
            <WeekList days={draft.days} selected={day} today={clock.dayOfWeek} nowMinute={clock.minuteOfDay} onSelect={setSelected} />

            <View style={{ gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, backgroundColor: t.bg }}>
              <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>
                {DAY_NAMES[day]}
                {day === clock.dayOfWeek ? ' (today)' : ''}
              </Text>
              <SwitchRow label="Fill on this day" value={window.on} disabled={!canEdit} onChange={(v) => setDay({ on: v })} />
              {window.on ? (
                <>
                  <DayBar start={window.start} end={window.end} nowMinute={day === clock.dayOfWeek ? clock.minuteOfDay : undefined} />
                  <TimeStepper label="Water comes on at" value={window.start} onChange={(v) => setDay({ start: v })} disabled={!canEdit} />
                  <TimeStepper label="Water goes off at" value={window.end} onChange={(v) => setDay({ end: v })} disabled={!canEdit} />
                  <Muted>{window.start === window.end ? 'The two times are the same.' : describeWindow(window.start, window.end)}</Muted>
                </>
              ) : (
                <Muted>No automatic filling on {DAY_NAMES[day]}, unless the tank gets very low and the low-level fill below is on.</Muted>
              )}
              <Text style={{ color: t.ink2, fontSize: 13 }}>Use {DAY_NAMES[day]}'s setting for</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button label="Every day" disabled={!canEdit || same(ALL_DAYS)} onPress={() => setDraft(copyDay(draft, day, ALL_DAYS))} style={{ flexGrow: 1 }} />
                <Button label="Mon to Fri" disabled={!canEdit || same(WEEKDAYS)} onPress={() => setDraft(copyDay(draft, day, WEEKDAYS))} style={{ flexGrow: 1 }} />
                <Button label="Sat and Sun" disabled={!canEdit || same(WEEKEND)} onPress={() => setDraft(copyDay(draft, day, WEEKEND))} style={{ flexGrow: 1 }} />
              </View>
            </View>

            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 }}>
              <SwitchRow label="Fill at any time when the tank is very low" value={lowOn} disabled={!canEdit} onChange={(v) => set({ lowLevel: v ? Math.min(DEFAULT_LOW_LEVEL, lowMax) : 0 })} />
              {lowOn ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <StepButton label="−5" hint="Low level: 5 percent lower" onPress={() => stepLow(-5)} disabled={!canEdit || draft.lowLevel <= 5} />
                  <Text style={{ flex: 1, textAlign: 'center', color: t.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{draft.lowLevel}%</Text>
                  <StepButton label="+5" hint="Low level: 5 percent higher" onPress={() => stepLow(5)} disabled={!canEdit || draft.lowLevel >= lowMax} />
                </View>
              ) : null}
              <Muted>
                {lowOn
                  ? `When the level drops to ${draft.lowLevel}% the unit fills straight away, even outside the filling times, and carries on to the stop point. If no water comes it closes the valve and tries again later. It must stay below the start point (${startPoint}%).`
                  : 'Off: outside the filling times the unit waits, however low the tank gets.'}
              </Muted>
            </View>

            <Row label="Time now at the unit" value={`${DAY_NAMES[clock.dayOfWeek]} ${formatClock(clock.minuteOfDay)} (${formatUtcOffset(unitOffset)})`} />
            {phoneOffset !== unitOffset ? (
              <SwitchRow label={`Change the unit to this phone's time zone (${formatUtcOffset(phoneOffset)})`} value={useLocalZone} disabled={!canEdit} onChange={setUseLocalZone} />
            ) : null}
          </>
        ) : null}

        {!online ? <Notice tone="muted" text="Unit offline: filling times cannot be saved now" /> : null}
        {online && !remote ? <Notice tone="warn" text="Remote control is switched off at the unit, so filling times are read-only here." /> : null}
        {built.error ? <Notice tone="warn" text={built.error} /> : null}
        {saver.result ? <Notice tone={saver.result.ok ? 'ok' : 'bad'} text={saver.result.text} /> : null}

        {saver.asking ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button kind="primary" label={changed ? 'Save filling times' : 'No changes'} busy={saver.busy} disabled={!changed || !canEdit} onPress={() => patch && saver.request(patch)} style={{ flexGrow: 1 }} />
            <Button label="Undo" disabled={(!changed && !built.error) || saver.busy} onPress={() => { setDraft(current); setUseLocalZone(false); }} />
          </View>
        )}
        <Muted>
          Saving asks for the settings PIN and ends a fill in progress. Manual open still works outside these times. A fill that is running when the time ends is stopped and continues in the next filling time.
        </Muted>
      </Card>
      {saver.prompt}
    </>
  );
}
