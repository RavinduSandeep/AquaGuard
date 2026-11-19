// AquaGuard phone app (Android, iOS and web from one codebase).
// Shows the tank remotely through Firebase and lets the owner enter data:
// settings, maintenance records and the installation record.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { rememberPin, useDevice, type Live } from './src/data';
import { DEMO_DEVICE_ID, startDemo, stopDemo } from './src/demo';
import { fb, firebaseConfigured } from './src/firebase';
import { normalizeDeviceId, parseSavedUnits, removeUnit, unitLabel, upsertUnit, type SavedUnit } from './src/logic';
import { Controls } from './src/screens/Controls';
import { Dashboard } from './src/screens/Dashboard';
import { History } from './src/screens/History';
import { Logbook } from './src/screens/Logbook';
import { Settings } from './src/screens/Settings';
import { UnitSwitcher } from './src/screens/Units';
import { Button, Card, Field, Icon, Muted, Notice, Row, styles, useTheme, type IconName } from './src/ui';
import { APP_VERSION, DATA_SCHEMA } from './src/version';

const DEVICE_KEY = 'aquaguard.deviceId'; // the unit shown now
const UNITS_KEY = 'aquaguard.units'; // every unit saved on this phone
const TABS = ['Tank', 'History', 'Control', 'Settings', 'Logbook', 'About'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = { Tank: 'tank', History: 'history', Control: 'control', Settings: 'settings', Logbook: 'logbook', About: 'about' };

function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Wrong e-mail or password';
  }
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again later';
  if (code.includes('network')) return 'No internet connection';
  return 'Could not sign in';
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      {children}
    </SafeAreaView>
  );
}

type Who = { email: string | null };

function DemoButton({ onDemo }: { onDemo: () => void }) {
  return (
    <Card title="Just looking?">
      <Button label="Open the demo with sample data" onPress={onDemo} />
      <Muted>A simulated tank you can explore and operate. Nothing is sent anywhere and no unit is needed.</Muted>
    </Card>
  );
}

function NotConfigured({ onDemo }: { onDemo: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Card title="Setup needed">
        <Notice tone="warn" text="Firebase is not configured for this build" />
        <Muted>
          Copy mobile/.env.example to mobile/.env, paste the values from your Firebase project (Project settings → Your apps → Web app), then restart with "npx expo start -c". Full steps are in docs/firebase-setup.md.
        </Muted>
      </Card>
      <DemoButton onDemo={onDemo} />
      <Muted>AquaGuard app {APP_VERSION}</Muted>
    </ScrollView>
  );
}

function SignIn({ onDemo }: { onDemo: () => void }) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(fb().auth, email.trim(), password);
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.screen, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 34, fontWeight: '800' }}>AquaGuard</Text>
        <Muted>Water tank monitoring and automatic filling</Muted>
        <Card title="Sign in">
          <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={submit} />
          {error ? <Notice tone="bad" text={error} /> : null}
          <Button kind="primary" label="Sign in" busy={busy} disabled={!email.trim() || !password} onPress={submit} />
          <Muted>Use the owner account you created in the Firebase console. There is no public sign-up.</Muted>
        </Card>
        <DemoButton onDemo={onDemo} />
        <Muted>App {APP_VERSION}</Muted>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PairDevice({ onPaired, onCancel }: { onPaired: (id: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState('');
  const id = normalizeDeviceId(text);
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Card title={onCancel ? 'Add another unit' : 'Connect your unit'}>
        <Field label="Device ID" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} placeholder="ag-1a2b3c" />
        <Muted>The Device ID is shown at the top of the unit's local dashboard and in its serial log at start-up.</Muted>
        <Button kind="primary" label="Connect" disabled={!id} onPress={() => id && onPaired(id)} />
        {onCancel ? <Button label="Cancel" onPress={onCancel} /> : <Button label="Sign out" onPress={() => signOut(fb().auth)} />}
        {onCancel ? <Muted>Each unit has its own Device ID, settings, filling times and PIN. Your account must be a member of the unit to see it.</Muted> : null}
      </Card>
    </ScrollView>
  );
}

function About({ live, deviceId, user, unitCount, onOpenUnits, onExitDemo }: { live: Live; deviceId: string; user: Who; unitCount: number; onOpenUnits: () => void; onExitDemo?: () => void }) {
  const s = live.status;
  const mismatch = s && s.schema !== DATA_SCHEMA;
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {mismatch ? (
        <Notice tone="warn" text={`The unit uses data schema ${s.schema}, this app expects ${DATA_SCHEMA}. Update the older one.`} />
      ) : null}
      <Card title="Versions">
        <Row label="App version" value={APP_VERSION} />
        <Row label="Firmware version" value={s?.fw ?? 'Unknown'} />
        <Row label="Data schema (app / unit)" value={`${DATA_SCHEMA} / ${s?.schema ?? '?'}`} tone={mismatch ? 'warn' : undefined} />
      </Card>
      <Card title="Connection">
        <Row label="Device ID" value={deviceId} />
        <Row label="Unit" value={live.online ? 'Online' : 'Offline'} tone={live.online ? 'ok' : 'warn'} />
        <Row label="This phone to Firebase" value={live.connected ? 'Connected' : 'Not connected'} tone={live.connected ? 'ok' : 'warn'} />
        <Row label="Remote control" value={s ? (s.remoteControl ? 'Allowed by the unit' : 'Switched off at the unit') : 'Unknown'} />
        <Row label="Signed in as" value={user.email ?? ''} />
        {onExitDemo ? (
          <Button label="Exit demo" onPress={onExitDemo} />
        ) : (
          <>
            <Row label="Units saved on this phone" value={String(unitCount)} />
            <Button label="Switch or add a unit" onPress={onOpenUnits} />
            <Button label="Sign out" onPress={() => signOut(fb().auth)} />
          </>
        )}
      </Card>
      <Card title="Safety">
        <Muted>
          This app is a remote view and convenience control. Protection against overfilling is done by the unit itself: the float loop and emergency stop cut valve power through relay K1 without any software, and the unit keeps filling safely with no internet. Keep the independent mechanical float valve and a clear overflow path in place.
        </Muted>
      </Card>
    </ScrollView>
  );
}

type UnitActions = {
  units: SavedUnit[];
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onName: (id: string, name: string) => void;
};

function Main({ user, deviceId, unitActions, onExitDemo }: { user: Who; deviceId: string; unitActions?: UnitActions; onExitDemo?: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('Tank');
  const [unitsOpen, setUnitsOpen] = useState(false);
  const live = useDevice(deviceId);
  const saved = unitActions?.units.find((u) => u.id === deviceId);
  // Until the unit reports, show the name saved from last time.
  const name = live.status?.tankName ?? (saved ? unitLabel(saved) : 'AquaGuard');

  // Keep the saved name in step with what the unit reports.
  const reportedId = live.status?.deviceId;
  const reportedName = live.status?.tankName;
  const onName = unitActions?.onName;
  useEffect(() => {
    if (onName && reportedName && reportedId === deviceId) onName(deviceId, reportedName);
  }, [onName, reportedName, reportedId, deviceId]);

  const title = (
    <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
      {name}
    </Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        {unitActions ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}. Switch or add a unit`}
            onPress={() => setUnitsOpen(true)}
            style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}
          >
            {title}
            <View style={{ borderWidth: 1, borderColor: t.line, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                {unitActions.units.length > 1 ? `Switch · ${unitActions.units.length}` : 'Units'}
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>{title}</View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: live.online ? t.ok : t.ink2 }} />
          <Text style={{ color: t.ink2, fontSize: 13 }}>{live.online ? 'Online' : live.loading ? 'Connecting…' : 'Offline'}</Text>
        </View>
      </View>

      {unitActions ? (
        <UnitSwitcher
          visible={unitsOpen}
          units={unitActions.units}
          currentId={deviceId}
          onClose={() => setUnitsOpen(false)}
          onSwitch={(id) => {
            setUnitsOpen(false);
            unitActions.onSwitch(id);
          }}
          onAdd={() => {
            setUnitsOpen(false);
            unitActions.onAdd();
          }}
          onRemove={unitActions.onRemove}
        />
      ) : null}

      {onExitDemo ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Notice tone="info" text="Demo: simulated tank, running faster than real life" />
        </View>
      ) : null}

      {live.error ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Notice tone="bad" text={live.error} />
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {tab === 'Tank' ? <Dashboard deviceId={deviceId} live={live} onOpenControl={() => setTab('Control')} /> : null}
        {tab === 'History' ? <History deviceId={deviceId} live={live} /> : null}
        {tab === 'Control' ? <Controls deviceId={deviceId} live={live} /> : null}
        {tab === 'Settings' ? <Settings deviceId={deviceId} live={live} /> : null}
        {tab === 'Logbook' ? <Logbook deviceId={deviceId} /> : null}
        {tab === 'About' ? <About live={live} deviceId={deviceId} user={user} unitCount={unitActions?.units.length ?? 0} onOpenUnits={() => setUnitsOpen(true)} onExitDemo={onExitDemo} /> : null}
      </View>

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.card }}>
        {TABS.map((name) => {
          const on = name === tab;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setTab(name)}
              style={{ flex: 1, minHeight: 58, gap: 2, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderTopColor: on ? t.accent : 'transparent' }}
            >
              <Icon name={TAB_ICONS[name]} color={on ? t.accent : t.ink2} />
              <Text style={{ color: on ? t.accent : t.ink2, fontSize: 11, fontWeight: on ? '800' : '500' }} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Root({ onDemo }: { onDemo: () => void }) {
  const t = useTheme();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [units, setUnits] = useState<SavedUnit[] | undefined>(undefined);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => onAuthStateChanged(fb().auth, setUser), []);

  // Load the saved list. A phone that used an earlier app version has only
  // the single Device ID, so that one is carried into the list.
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(UNITS_KEY), AsyncStorage.getItem(DEVICE_KEY)])
      .then(([rawUnits, rawCurrent]) => {
        let list = parseSavedUnits(rawUnits);
        const last = rawCurrent ? normalizeDeviceId(rawCurrent) : null;
        if (last) list = upsertUnit(list, last);
        const current = last && list.some((u) => u.id === last) ? last : (list[0]?.id ?? null);
        setUnits(list);
        setDeviceId(current);
      })
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    if (units) AsyncStorage.setItem(UNITS_KEY, JSON.stringify(units)).catch(() => {});
  }, [units]);

  const show = useCallback((id: string | null) => {
    rememberPin(null); // each unit has its own settings PIN
    setDeviceId(id);
    (id ? AsyncStorage.setItem(DEVICE_KEY, id) : AsyncStorage.removeItem(DEVICE_KEY)).catch(() => {});
  }, []);

  const onName = useCallback((id: string, name: string) => setUnits((list) => (list ? upsertUnit(list, id, name) : list)), []);

  if (user === undefined || units === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }
  if (!user) return <SignIn onDemo={onDemo} />;
  if (!deviceId || adding) {
    return (
      <PairDevice
        onCancel={deviceId ? () => setAdding(false) : undefined}
        onPaired={(id) => {
          setUnits(upsertUnit(units, id));
          show(id);
          setAdding(false);
        }}
      />
    );
  }
  return (
    <Main
      key={deviceId} // a fresh screen per unit: no settings form carried across
      user={user}
      deviceId={deviceId}
      unitActions={{
        units,
        onSwitch: show,
        onAdd: () => setAdding(true),
        onName,
        onRemove: (id) => {
          const rest = removeUnit(units, id);
          setUnits(rest);
          if (id === deviceId) show(rest[0]?.id ?? null);
        },
      }}
    />
  );
}

export default function App() {
  const [demo, setDemo] = useState(false);
  const enterDemo = () => {
    startDemo();
    setDemo(true);
  };
  const exitDemo = () => {
    setDemo(false);
    stopDemo();
  };
  return (
    <SafeAreaProvider>
      <Shell>
        {demo ? (
          <Main user={{ email: 'demo' }} deviceId={DEMO_DEVICE_ID} onExitDemo={exitDemo} />
        ) : firebaseConfigured ? (
          <Root onDemo={enterDemo} />
        ) : (
          <NotConfigured onDemo={enterDemo} />
        )}
      </Shell>
    </SafeAreaProvider>
  );
}
