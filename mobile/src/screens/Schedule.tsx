// Filling times: the hours when the water supply is on, set for each day of
// the week. The unit only starts an automatic fill inside them, except when
// the tank is very low (low-level fill). Saving needs the settings PIN.
import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { type Live } from '../data';
import {
  applyOnTime,
  commonOnTime,
  copyDay,
  DAY_NAMES,
  DEFAULT_LOW_LEVEL,
  describeWindow,
  formatClock,
  formatLength,
  formatUtcOffset,
  from12h,
  parseOnTime,
  scheduleFromConfig,
  schedulePatch,
  setDayStart,
  to12h,
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

function NumberBox({ value, onChangeText, onBlur, label, disabled, bad }: { value: string; onChangeText: (v: string) => void; onBlur?: () => void; label: string; disabled: boolean; bad?: boolean }) {
  const t = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={(v) => onChangeText(v.replace(/[^0-9]/g, '').slice(0, 2))}
      onBlur={onBlur}
      editable={!disabled}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={2}
      selectTextOnFocus
      style={{
        width: 64,
        minHeight: 56,
        borderWidth: 2,
        borderColor: bad ? t.warn : t.line,
        borderRadius: 12,
        backgroundColor: t.card,
        color: t.ink,
        fontSize: 28,
        fontWeight: '800',
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}

/** Time entry like an alarm clock: hour, minute, then AM or PM. */
function TimeInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  const t = useTheme();
  const shown = to12h(value);
  const [hour, setHour] = useState(String(shown.hour));
  const [minute, setMinute] = useState(String(shown.minute).padStart(2, '0'));
  const [pm, setPm] = useState(shown.pm);

  // Follow a change made elsewhere (Undo, a copy, a report from the unit).
  useEffect(() => {
    if (from12h(hour, minute, pm) !== value) {
      const now = to12h(value);
      setHour(String(now.hour));
      setMinute(String(now.minute).padStart(2, '0'));
      setPm(now.pm);
    }
    // Only when the value itself changes; typing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const typed = from12h(hour, minute, pm);
  const commit = (h: string, m: string, p: boolean) => {
    const next = from12h(h, m, p);
    if (next !== null && next !== value) onChange(next);
  };
  const half = (isPm: boolean, text: string) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: pm === isPm, disabled }}
      accessibilityLabel={`${label}: ${text}`}
      disabled={disabled}
      onPress={() => {
        setPm(isPm);
        commit(hour, minute, isPm);
      }}
      style={{ minWidth: 56, minHeight: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: pm === isPm ? t.accent : t.card }}
    >
      <Text style={{ color: pm === isPm ? t.onAccent : t.ink2, fontSize: 14, fontWeight: '800' }}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink2, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <NumberBox label={`${label}: hour, 1 to 12`} value={hour} disabled={disabled} bad={typed === null} onChangeText={(v) => { setHour(v); commit(v, minute, pm); }} />
        <Text style={{ color: t.ink, fontSize: 28, fontWeight: '800' }}>:</Text>
        <NumberBox
          label={`${label}: minute, 0 to 59`}
          value={minute}
          disabled={disabled}
          bad={typed === null}
          onChangeText={(v) => { setMinute(v); commit(hour, v, pm); }}
          onBlur={() => { if (/^\d$/.test(minute)) setMinute(minute.padStart(2, '0')); }}
        />
        <View accessibilityRole="radiogroup" style={{ borderWidth: 2, borderColor: t.line, borderRadius: 12, overflow: 'hidden', opacity: disabled ? 0.5 : 1 }}>
          {half(false, 'AM')}
          {half(true, 'PM')}
        </View>
      </View>
      {typed === null ? <Text style={{ color: t.warn, fontSize: 13, fontWeight: '600' }}>Enter an hour from 1 to 12 and a minute from 0 to 59</Text> : null}
    </View>
  );
}

const ON_TIME_PRESETS = [10, 15, 30, 60, 120];

/** How long the valve may stay on, the same for every filling time. */
function OnTime({ value, onChange, disabled }: { value: number | null; onChange: (minutes: number) => void; disabled: boolean }) {
  const t = useTheme();
  const [hours, setHours] = useState(value === null ? '' : String(Math.floor(value / 60)));
  const [minutes, setMinutes] = useState(value === null ? '' : String(value % 60));

  useEffect(() => {
    if (value !== null && parseOnTime(hours, minutes) !== value) {
      setHours(String(Math.floor(value / 60)));
      setMinutes(String(value % 60));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const typed = parseOnTime(hours, minutes);
  const empty = hours === '' && minutes === '';
  const commit = (h: string, m: string) => {
    const next = parseOnTime(h, m);
    if (next !== null && next !== value) onChange(next);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>Valve on time</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <NumberBox label="Valve on time: hours" value={hours} disabled={disabled} bad={!empty && typed === null} onChangeText={(v) => { setHours(v); commit(v, minutes); }} />
        <Text style={{ color: t.ink2, fontSize: 15 }}>h</Text>
        <NumberBox label="Valve on time: minutes" value={minutes} disabled={disabled} bad={!empty && typed === null} onChangeText={(v) => { setMinutes(v); commit(hours, v); }} />
        <Text style={{ color: t.ink2, fontSize: 15 }}>min</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {ON_TIME_PRESETS.map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: value === m, disabled }}
            accessibilityLabel={`Valve on time ${formatLength(m)}`}
            disabled={disabled}
            onPress={() => onChange(m)}
            style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999, borderWidth: value === m ? 2 : 1, borderColor: value === m ? t.accent : t.line, backgroundColor: value === m ? t.waterWash : t.card, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}
          >
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>{formatLength(m)}</Text>
          </Pressable>
        ))}
      </View>
      {!empty && typed === null ? <Text style={{ color: t.warn, fontSize: 13, fontWeight: '600' }}>Enter between 1 minute and 23 h 59 min</Text> : null}
      <Muted>
        {value === null
          ? 'The days have different lengths now. Enter a valve on time to use the same one for every day.'
          : `Used for every day: each filling time ends ${formatLength(value)} after it starts, so you only enter the start time.`}
      </Muted>
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
  const onTime = commonOnTime(draft);
  const hasTopUp = config.fillAtWindowStart !== undefined;

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
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 }}>
              <OnTime value={onTime} disabled={!canEdit} onChange={(m) => setDraft(applyOnTime(draft, m))} />
              {hasTopUp ? (
                <>
                  <SwitchRow label="Open the valve when each filling time starts" value={draft.topUp} disabled={!canEdit} onChange={(v) => set({ topUp: v })} />
                  <Muted>
                    {draft.topUp
                      ? `On: the valve opens at the start time and closes when the valve on time is over or the tank reaches the stop point, whichever comes first. Skipped if the tank is already within 5% of the stop point.`
                      : `Off: inside a filling time the valve opens only when the level is at or below the start point (${startPoint}%).`}
                  </Muted>
                </>
              ) : null}
            </View>

            <Muted>Tap a day to change its start time.</Muted>
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
                  <TimeInput key={day} label="Start time" value={window.start} onChange={(v) => setDraft(setDayStart(draft, day, v))} disabled={!canEdit} />
                  <Row label="Ends at" value={describeWindow(window.start, window.end).replace(/^.*? to /, '')} />
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
