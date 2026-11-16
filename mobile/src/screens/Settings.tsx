import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';

import { type Live } from '../data';
import { buildPatch, draftFromConfig, SETTINGS, type Draft } from '../logic';
import { useSettingsSave } from '../pin';
import { Button, Card, Field, Muted, Notice, styles, useTheme } from '../ui';

export function Settings({ deviceId, live }: { deviceId: string; live: Live }) {
  const t = useTheme();
  const { config, status, online } = live;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revision, setRevision] = useState<unknown>(null);
  const saver = useSettingsSave(deviceId);
  const { busy, result } = saver;

  // Load the form from the unit, and reload whenever the unit reports a change.
  useEffect(() => {
    if (config && config.revision !== revision) {
      setDraft(draftFromConfig(config));
      setRevision(config.revision);
    }
  }, [config, revision]);

  if (!config || !draft) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Notice tone="muted" text="Waiting for the unit to report its settings" />
      </ScrollView>
    );
  }

  const built = buildPatch(config, draft);
  const changed = built.patch ? Object.keys(built.patch).length : 0;
  const remote = status?.remoteControl ?? false;

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {!online ? <Notice tone="muted" text="Unit offline: settings cannot be saved now" /> : null}
      {online && !remote ? <Notice tone="warn" text="Remote control is switched off at the unit, so settings are read-only here." /> : null}

      {SETTINGS.map((group) => (
        <Card key={group.title} title={group.title}>
          {group.fields.map((f) => {
            const editable = !f.localOnly && remote && online;
            if (f.kind === 'boolean') {
              return (
                <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
                  <Text style={{ color: t.ink, fontSize: 15, flex: 1 }}>{f.label}</Text>
                  <Switch
                    value={Boolean(draft[f.key])}
                    disabled={!editable}
                    onValueChange={(v) => setDraft({ ...draft, [f.key]: v })}
                    accessibilityLabel={f.label}
                  />
                </View>
              );
            }
            return (
              <Field
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={String(draft[f.key] ?? '')}
                editable={editable}
                keyboardType={f.kind === 'text' ? 'default' : 'decimal-pad'}
                onChangeText={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            );
          })}
          {group.fields.some((f) => f.localOnly) ? (
            <Muted>Calibration and commissioning are done on site from the unit's own dashboard, with the service valve isolated.</Muted>
          ) : null}
        </Card>
      ))}

      {built.error ? <Notice tone="warn" text={built.error} /> : null}
      {result ? <Notice tone={result.ok ? 'ok' : 'bad'} text={result.text} /> : null}
      {saver.prompt}
      {saver.asking ? null : (
        <>
          <Button
            kind="primary"
            label={changed ? `Save ${changed} change${changed === 1 ? '' : 's'} to the unit` : 'No changes'}
            busy={busy}
            disabled={!changed || !online || !remote}
            onPress={() => built.patch && saver.request(built.patch)}
          />
          <Button label="Discard changes" disabled={(!changed && !built.error) || busy} onPress={() => setDraft(draftFromConfig(config))} />
        </>
      )}
      <Muted>Saving asks for the settings PIN. The unit checks every value again and closes the valve while settings change. A fill in progress is ended. Filling times are on the Control tab.</Muted>
    </ScrollView>
  );
}
