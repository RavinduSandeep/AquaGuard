// Data entry: maintenance records and the installed-configuration record.
// Checklists follow the maintenance schedule in guide section 17 and the
// handover record in section 18.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { addLogbookEntry, deleteLogbookEntry, useLogbook, useRecord } from '../data';
import { Button, Card, Field, Muted, Notice, styles, useTheme } from '../ui';

const KINDS: { kind: string; checks: string[] }[] = [
  {
    kind: 'Monthly check',
    checks: [
      'Raised the float by hand: valve shut off',
      'Pressed the emergency stop: valve shut off',
      'Confirmed water actually stopped flowing',
      'No leaks at valve, unions and fittings',
      'Overflow path clear',
    ],
  },
  {
    kind: 'Quarterly service',
    checks: [
      'Cleaned the strainer',
      'Probe aligned and clean',
      'Cable glands and enclosures sealed',
      'Terminals tight, no heat damage',
      'Calibration confirmed at a known level',
    ],
  },
  { kind: 'After storm, plumbing work or firmware update', checks: ['Repeated the interlock tests', 'Repeated the sensor-loss test', 'Checked rooftop box for water'] },
  { kind: 'Note', checks: [] },
];

const RECORD_FIELDS: [string, string][] = [
  ['board', 'ESP32-S3 module and board revision'],
  ['sensor', 'Sensor revision and automatic UART mode'],
  ['valve', 'Valve model, pressure, duty and pipe fittings'],
  ['float', 'Float opening level and physical clearance'],
  ['distances', 'Full distance and empty distance (cm)'],
  ['capacity', 'Usable capacity (L) and tank shape'],
  ['flow', 'Measured fill flow (L/min) and shutoff time (s)'],
  ['levels', 'Normal stop and emergency maximum level'],
  ['electrical', 'Fuses, rail readings and cable route length'],
  ['handover', 'Firmware version, local IP and test date'],
];

export function Logbook({ deviceId }: { deviceId: string }) {
  const t = useTheme();
  const entries = useLogbook(deviceId);
  const { record, save } = useRecord(deviceId);

  const [kindIndex, setKindIndex] = useState(0);
  const [ticked, setTicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [recordDraft, setRecordDraft] = useState<Record<string, string>>({});
  const [recordDirty, setRecordDirty] = useState(false);
  useEffect(() => {
    if (!recordDirty) setRecordDraft(record);
  }, [record, recordDirty]);

  const kind = KINDS[kindIndex];
  const canSave = ticked.length > 0 || note.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await addLogbookEntry(deviceId, { kind: kind.kind, checks: ticked, note: note.trim() });
      setTicked([]);
      setNote('');
      setMessage({ ok: true, text: 'Entry saved' });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not save the entry' });
    } finally {
      setBusy(false);
    }
  };

  const saveRecord = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const clean: Record<string, string> = {};
      for (const [key] of RECORD_FIELDS) if (recordDraft[key]?.trim()) clean[key] = recordDraft[key].trim();
      await save(clean);
      setRecordDirty(false);
      setMessage({ ok: true, text: 'Installation record saved' });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not save the record' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {message ? <Notice tone={message.ok ? 'ok' : 'bad'} text={message.text} /> : null}

      <Card title="New entry">
        <View style={styles.wrap}>
          {KINDS.map((k, i) => (
            <Button
              key={k.kind}
              label={k.kind}
              kind={i === kindIndex ? 'primary' : 'plain'}
              onPress={() => {
                setKindIndex(i);
                setTicked([]);
              }}
            />
          ))}
        </View>
        {kind.checks.map((check) => {
          const on = ticked.includes(check);
          return (
            <Pressable
              key={check}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => setTicked(on ? ticked.filter((c) => c !== check) : [...ticked, check])}
              style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 }}
            >
              <View
                style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: on ? t.accent : t.ink2, backgroundColor: on ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}
              >
                {on ? <Text style={{ color: t.onAccent, fontWeight: '900' }}>✓</Text> : null}
              </View>
              <Text style={{ color: t.ink, fontSize: 15, flex: 1 }}>{check}</Text>
            </Pressable>
          );
        })}
        <Field label="Notes, readings or problems found" value={note} onChangeText={setNote} multiline maxLength={1000} />
        <Button kind="primary" label="Save entry" busy={busy} disabled={!canSave} onPress={submit} />
        <Muted>Tick only what you actually tested. A displayed CLOSED command does not prove shutoff: confirm real water flow.</Muted>
      </Card>

      <Card title="Past entries">
        {entries.length ? (
          entries.map((e) => (
            <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: t.line, paddingVertical: 10, gap: 3 }}>
              <Text style={{ color: t.ink, fontWeight: '700' }}>{e.kind}</Text>
              <Muted>
                {e.at ? new Date(e.at).toLocaleString() : ''}
                {e.by ? ` · ${e.by}` : ''}
              </Muted>
              {(e.checks ?? []).map((c) => (
                <Text key={c} style={{ color: t.ink, fontSize: 14 }}>
                  ✓ {c}
                </Text>
              ))}
              {e.note ? <Text style={{ color: t.ink, fontSize: 14 }}>{e.note}</Text> : null}
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  if (confirmDelete !== e.id) return setConfirmDelete(e.id);
                  setConfirmDelete(null);
                  deleteLogbookEntry(deviceId, e.id).catch(() => setMessage({ ok: false, text: 'Could not delete the entry' }));
                }}
              >
                <Text style={{ color: t.bad, fontSize: 13, paddingTop: 4 }}>
                  {confirmDelete === e.id ? 'Tap again to delete permanently' : 'Delete entry'}
                </Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Muted>Nothing recorded yet. The guide asks for a monthly check and a quarterly service.</Muted>
        )}
      </Card>

      <Card title="Installation record">
        <Muted>Fill this in at assembly and commissioning, and keep it with the unit.</Muted>
        {RECORD_FIELDS.map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={recordDraft[key] ?? ''}
            maxLength={200}
            onChangeText={(v) => {
              setRecordDraft({ ...recordDraft, [key]: v });
              setRecordDirty(true);
            }}
          />
        ))}
        <Button kind="primary" label="Save installation record" busy={busy} disabled={!recordDirty} onPress={saveRecord} />
      </Card>
    </ScrollView>
  );
}
