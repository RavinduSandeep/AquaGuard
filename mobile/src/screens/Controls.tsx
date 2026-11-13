import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { sendCommand, type Command, type Live } from '../data';
import { formatDuration, humanize } from '../logic';
import { Button, Card, Muted, Notice, Row, styles } from '../ui';

export function Controls({ deviceId, live }: { deviceId: string; live: Live }) {
  const { status, online } = live;
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = async (key: string, command: Command, done: string) => {
    setBusy(key);
    setResult(null);
    try {
      const r = await sendCommand(deviceId, command);
      setResult({ ok: r.ok, text: r.ok ? done : `Refused: ${humanize(r.reason)}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not send the request' });
    } finally {
      setBusy(null);
      setConfirmOpen(false);
    }
  };

  if (!status) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Notice tone="muted" text="Waiting for the unit to report" />
      </ScrollView>
    );
  }

  const remote = status.remoteControl;
  const locked = !online || !remote || busy !== null;
  const blocker = status.valve.openBlocker;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {!online ? <Notice tone="muted" text="Unit offline: requests cannot reach it" /> : null}
      {online && !remote ? (
        <Notice tone="warn" text="Remote control is switched off at the unit. Only Close and Mute work from here." />
      ) : null}
      {result ? <Notice tone={result.ok ? 'ok' : 'bad'} text={result.text} /> : null}

      <Card title="Stop">
        <Button
          kind="danger"
          label="Close valve now"
          busy={busy === 'close'}
          disabled={!online || (busy !== null && busy !== 'close')}
          onPress={() => run('close', { type: 'close' }, 'Valve commanded closed. Mode is now Manual.')}
        />
        <Muted>
          Always accepted. In Auto it also switches to Manual so the unit does not reopen by itself. This is not the emergency stop: for an emergency use the red button on the unit.
        </Muted>
      </Card>

      <Card title="Mode">
        <View style={styles.wrap}>
          {(['AUTO', 'MANUAL', 'MAINTENANCE'] as const).map((mode) => (
            <Button
              key={mode}
              label={mode.charAt(0) + mode.slice(1).toLowerCase()}
              kind={status.mode === mode ? 'primary' : 'plain'}
              busy={busy === mode}
              disabled={locked || status.mode === mode}
              onPress={() => run(mode, { type: 'setMode', mode }, `Mode set to ${mode.toLowerCase()}`)}
              style={{ flexGrow: 1 }}
            />
          ))}
        </View>
        <Muted>Auto fills from the start level to the stop level. Maintenance suspends automatic filling for a limited time, then returns to the previous mode.</Muted>
      </Card>

      <Card title="Manual open">
        <Row label="Mode" value={status.mode} />
        <Row label="Would be blocked by" value={status.mode === 'AUTO' ? humanize('WRONG_MODE') : humanize(blocker)} />
        {status.valve.manualRemainingS ? <Row label="Closes automatically in" value={formatDuration(status.valve.manualRemainingS)} /> : null}
        {confirmOpen ? (
          <View style={styles.wrap}>
            <Button label="Yes, open the valve" kind="primary" busy={busy === 'open'} disabled={locked} onPress={() => run('open', { type: 'open' }, 'Valve commanded open (time limited)')} style={{ flexGrow: 1 }} />
            <Button label="Cancel" onPress={() => setConfirmOpen(false)} style={{ flexGrow: 1 }} />
          </View>
        ) : (
          <Button label="Open valve (time limited)…" disabled={locked || status.mode === 'AUTO'} onPress={() => setConfirmOpen(true)} />
        )}
        <Muted>Only in Manual or Maintenance. The float, emergency stop, sensor checks, stop level and time limit all stay active. Do not open the valve when nobody can check the tank.</Muted>
      </Card>

      <Card title="Alarms">
        <View style={styles.wrap}>
          <Button label="Acknowledge / arm" kind="primary" busy={busy === 'ack'} disabled={locked} onPress={() => run('ack', { type: 'ack' }, 'Acknowledged')} style={{ flexGrow: 1 }} />
          <Button label="Mute buzzer" busy={busy === 'mute'} disabled={!online || busy !== null} onPress={() => run('mute', { type: 'mute' }, 'Buzzer muted')} style={{ flexGrow: 1 }} />
        </View>
        <Muted>Acknowledge only clears faults whose cause is gone, and arms the unit when every check is healthy. An emergency stop can only be acknowledged at the unit. Muting never clears a fault.</Muted>
      </Card>
    </ScrollView>
  );
}
