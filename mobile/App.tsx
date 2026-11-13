// AquaGuard phone app (Android, iOS and web from one codebase).
// Shows the tank remotely through Firebase and lets the owner enter data:
// settings, maintenance records and the installation record.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useDevice, type Live } from './src/data';
import { DEMO_DEVICE_ID, startDemo, stopDemo } from './src/demo';
import { fb, firebaseConfigured } from './src/firebase';
import { normalizeDeviceId } from './src/logic';
import { Controls } from './src/screens/Controls';
import { Dashboard } from './src/screens/Dashboard';
import { History } from './src/screens/History';
import { Logbook } from './src/screens/Logbook';
import { Settings } from './src/screens/Settings';
import { Button, Card, Field, Muted, Notice, Row, styles, useTheme } from './src/ui';
import { APP_VERSION, DATA_SCHEMA } from './src/version';

const DEVICE_KEY = 'aquaguard.deviceId';
const TABS = ['Tank', 'History', 'Control', 'Settings', 'Logbook', 'About'] as const;
type Tab = (typeof TABS)[number];

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

function PairDevice({ onPaired, initial }: { onPaired: (id: string) => void; initial?: string }) {
  const [text, setText] = useState(initial ?? '');
  const id = normalizeDeviceId(text);
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Card title="Connect your unit">
        <Field label="Device ID" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} placeholder="ag-1a2b3c" />
        <Muted>The Device ID is shown at the top of the unit's local dashboard and in its serial log at start-up.</Muted>
        <Button kind="primary" label="Connect" disabled={!id} onPress={() => id && onPaired(id)} />
        <Button label="Sign out" onPress={() => signOut(fb().auth)} />
      </Card>
    </ScrollView>
  );
}

function About({ live, deviceId, user, onChangeDevice, onExitDemo }: { live: Live; deviceId: string; user: Who; onChangeDevice: () => void; onExitDemo?: () => void }) {
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
            <Button label="Use a different unit" onPress={onChangeDevice} />
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

function Main({ user, deviceId, onChangeDevice, onExitDemo }: { user: Who; deviceId: string; onChangeDevice: () => void; onExitDemo?: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('Tank');
  const live = useDevice(deviceId);
  const name = live.status?.tankName ?? 'AquaGuard';

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', flex: 1 }} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: live.online ? t.ok : t.ink2 }} />
          <Text style={{ color: t.ink2, fontSize: 13 }}>{live.online ? 'Online' : live.loading ? 'Connecting…' : 'Offline'}</Text>
        </View>
      </View>

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
        {tab === 'Tank' ? <Dashboard live={live} /> : null}
        {tab === 'History' ? <History deviceId={deviceId} live={live} /> : null}
        {tab === 'Control' ? <Controls deviceId={deviceId} live={live} /> : null}
        {tab === 'Settings' ? <Settings deviceId={deviceId} live={live} /> : null}
        {tab === 'Logbook' ? <Logbook deviceId={deviceId} /> : null}
        {tab === 'About' ? <About live={live} deviceId={deviceId} user={user} onChangeDevice={onChangeDevice} onExitDemo={onExitDemo} /> : null}
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
              style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderTopColor: on ? t.accent : 'transparent' }}
            >
              <Text style={{ color: on ? t.accent : t.ink2, fontSize: 12, fontWeight: on ? '800' : '500' }} numberOfLines={1}>
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
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  const [pairing, setPairing] = useState(false);

  useEffect(() => onAuthStateChanged(fb().auth, setUser), []);
  useEffect(() => {
    AsyncStorage.getItem(DEVICE_KEY)
      .then((v) => setDeviceId(v ? normalizeDeviceId(v) : null))
      .catch(() => setDeviceId(null));
  }, []);

  if (user === undefined || deviceId === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }
  if (!user) return <SignIn onDemo={onDemo} />;
  if (!deviceId || pairing) {
    return (
      <PairDevice
        initial={deviceId ?? ''}
        onPaired={(id) => {
          AsyncStorage.setItem(DEVICE_KEY, id).catch(() => {});
          setDeviceId(id);
          setPairing(false);
        }}
      />
    );
  }
  return <Main user={user} deviceId={deviceId} onChangeDevice={() => setPairing(true)} />;
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
          <Main user={{ email: 'demo' }} deviceId={DEMO_DEVICE_ID} onChangeDevice={() => {}} onExitDemo={exitDemo} />
        ) : firebaseConfigured ? (
          <Root onDemo={enterDemo} />
        ) : (
          <NotConfigured onDemo={enterDemo} />
        )}
      </Shell>
    </SafeAreaProvider>
  );
}
