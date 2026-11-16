// Asking for the settings PIN before a settings change is sent to the unit.
// The unit checks the PIN; the app only collects it.
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

import { getRememberedPin, rememberPin, sendCommand } from './data';
import { demoActive } from './demo';
import { humanize, pinLooksValid, type DeviceConfig } from './logic';
import { Button, Card, Field, Muted, Notice, styles } from './ui';

type Result = { ok: boolean; text: string };

/**
 * `request(patch)` sends a settings change. The PIN is asked for the first
 * time and after a wrong one; once the unit accepts it, it is reused until
 * the app is closed. Render `prompt` where the question should appear.
 */
export function useSettingsSave(deviceId: string, savedText = 'Saved on the unit') {
  const [pending, setPending] = useState<DeviceConfig | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const send = async (patch: DeviceConfig, withPin: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await sendCommand(deviceId, { type: 'setConfig', config: patch, pin: withPin });
      if (r.ok) {
        rememberPin(withPin);
        setPending(null);
        setPinError(null);
        setResult({ ok: true, text: savedText });
      } else if (r.reason === 'WRONG_PIN' || r.reason === 'PIN_LOCKED') {
        rememberPin(null);
        setPending(patch);
        setPinError(humanize(r.reason));
      } else {
        setPending(null);
        setResult({ ok: false, text: `Not saved: ${humanize(r.reason)}` });
      }
    } catch (e) {
      setPending(null);
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not send the settings' });
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  const request = (patch: DeviceConfig) => {
    const known = getRememberedPin();
    if (known) {
      send(patch, known);
    } else {
      setResult(null);
      setPinError(null);
      setPending(patch);
    }
  };

  const prompt: ReactNode = pending ? (
    <Card title="Enter the settings PIN">
      <Field
        label="PIN"
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus
        maxLength={8}
        editable={!busy}
        onSubmitEditing={() => pinLooksValid(pin) && send(pending, pin)}
        accessibilityLabel="Settings PIN"
      />
      {pinError ? <Notice tone="bad" text={pinError} /> : null}
      <View style={styles.wrap}>
        <Button kind="primary" label="Confirm" busy={busy} disabled={!pinLooksValid(pin)} onPress={() => send(pending, pin)} style={{ flexGrow: 1 }} />
        <Button label="Cancel" disabled={busy} onPress={() => { setPending(null); setPin(''); }} style={{ flexGrow: 1 }} />
      </View>
      <Muted>
        {demoActive()
          ? 'Demo PIN: 4211.'
          : 'Anyone with access to this unit who knows the PIN can change its settings. The owner sets the PIN on the unit\'s own page.'}
      </Muted>
    </Card>
  ) : null;

  return { request, prompt, busy, result, asking: pending !== null };
}
