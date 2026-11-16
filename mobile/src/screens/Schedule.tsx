// Filling times: the hours when the water supply is on. The unit only starts
// an automatic fill inside them. Saving needs the settings PIN.
import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { type Live } from '../data';
import {
  describeWindow,
  formatClock,
  formatUtcOffset,
  scheduleFromConfig,
  schedulePatch,
  stepClock,
  unitClock,
  windowSegments,
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

function DayGroup({ title, start, end, onStart, onEnd, disabled, nowMinute }: { title: string; start: number; end: number; onStart: (v: number) => void; onEnd: (v: number) => void; disabled: boolean; nowMinute?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12 }}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{title}</Text>
      <DayBar start={start} end={end} nowMinute={nowMinute} />
      <TimeStepper label="Water comes on at" value={start} onChange={onStart} disabled={disabled} />
      <TimeStepper label="Water goes off at" value={end} onChange={onEnd} disabled={disabled} />
      <Muted>{start === end ? 'The two times are the same.' : describeWindow(start, end)}</Muted>
    </View>
  );
}

export function FillingTimes({ deviceId, live }: { deviceId: string; live: Live }) {
  const t = useTheme();
  const { config, status, online, serverNow } = live;
  const current = scheduleFromConfig(config);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [revision, setRevision] = useState<unknown>(null);
  const [useLocalZone, setUseLocalZone] = useState(false);
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
        <Muted>This unit's firmware does not have filling times yet. Update it to version 0.5.0 or later.</Muted>
      </Card>
    );
  }

  const remote = status?.remoteControl ?? false;
  const canEdit = online && remote && !saver.busy;
  const unitOffset = Number(config.utcOffsetMinutes ?? 330);
  const phoneOffset = -new Date().getTimezoneOffset();
  const clock = unitClock(serverNow, unitOffset);
  const weekendToday = clock.dayOfWeek === 0 || clock.dayOfWeek === 6;

  const built = schedulePatch(config, draft);
  const patch = built.patch ? { ...built.patch, ...(useLocalZone ? { utcOffsetMinutes: phoneOffset } : {}) } : null;
  const changed = patch ? Object.keys(patch).length : 0;
  const set = (part: Partial<Schedule>) => setDraft({ ...draft, ...part });
  const live_ = status?.schedule;

  return (
    <>
      <Card title="Filling times">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>Fill only when the supply is on</Text>
          <Switch value={draft.enabled} disabled={!canEdit} onValueChange={(v) => set({ enabled: v })} accessibilityLabel="Fill only when the supply is on" />
        </View>
        <Muted>
          {draft.enabled
            ? 'The unit starts an automatic fill only inside the times below. Outside them it waits, even when the tank is low.'
            : 'Off: the unit fills at any time the level drops to the start point.'}
        </Muted>

        {current.enabled && live_ && online ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {!live_.clockKnown ? (
              <Chip tone="warn" label="Unit has no clock time: times not applied" />
            ) : live_.waiting ? (
              <Chip tone="info" label="Tank is low: waiting for the next filling time" />
            ) : (
              <Chip tone={live_.open ? 'ok' : 'muted'} label={live_.open ? 'Inside a filling time now' : 'Outside the filling times now'} />
            )}
          </View>
        ) : null}

        {draft.enabled ? (
          <>
            <DayGroup
              title="Weekdays (Monday to Friday)"
              start={draft.weekdayStart}
              end={draft.weekdayEnd}
              onStart={(v) => set({ weekdayStart: v })}
              onEnd={(v) => set({ weekdayEnd: v })}
              disabled={!canEdit}
              nowMinute={weekendToday ? undefined : clock.minuteOfDay}
            />
            <DayGroup
              title="Weekends (Saturday and Sunday)"
              start={draft.weekendStart}
              end={draft.weekendEnd}
              onStart={(v) => set({ weekendStart: v })}
              onEnd={(v) => set({ weekendEnd: v })}
              disabled={!canEdit}
              nowMinute={weekendToday ? clock.minuteOfDay : undefined}
            />
            <Button
              label="Use the weekday times for weekends too"
              disabled={!canEdit || (draft.weekendStart === draft.weekdayStart && draft.weekendEnd === draft.weekdayEnd)}
              onPress={() => set({ weekendStart: draft.weekdayStart, weekendEnd: draft.weekdayEnd })}
            />
            <Row label="Time now at the unit" value={`${formatClock(clock.minuteOfDay)} (${formatUtcOffset(unitOffset)})`} />
            {phoneOffset !== unitOffset ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
                <Text style={{ color: t.ink, fontSize: 15, flex: 1 }}>Change the unit to this phone's time zone ({formatUtcOffset(phoneOffset)})</Text>
                <Switch value={useLocalZone} disabled={!canEdit} onValueChange={setUseLocalZone} accessibilityLabel="Use this phone's time zone" />
              </View>
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
