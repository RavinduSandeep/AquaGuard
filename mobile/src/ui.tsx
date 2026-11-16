// Theme tokens and the small set of shared building blocks.
import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import Svg, { Circle, Path } from 'react-native-svg';

import { type Tone } from './logic';

const light = {
  bg: '#f1f4f7',
  card: '#fcfcfb',
  ink: '#0e1b26',
  ink2: '#4c5a66',
  line: '#d8dfe6',
  accent: '#0b3a5b',
  onAccent: '#ffffff',
  water: '#2a78d6', // chart series slot 1
  waterWash: 'rgba(42,120,214,0.10)',
  fillBand: 'rgba(27,175,122,0.16)',
  ok: '#1c7c3c',
  warn: '#9a5200',
  bad: '#b3211c',
  onBad: '#ffffff',
  info: '#1f6fb5',
};
const dark: typeof light = {
  bg: '#0c141b',
  card: '#1a1a19',
  ink: '#f0efec',
  ink2: '#c3c2b7',
  line: '#2c3944',
  accent: '#8cc8f0',
  onAccent: '#08202f',
  water: '#3987e5',
  waterWash: 'rgba(57,135,229,0.14)',
  fillBand: 'rgba(25,158,112,0.22)',
  ok: '#5fcf85',
  warn: '#f0a84a',
  bad: '#ff7b72',
  onBad: '#2a0806',
  info: '#6bb6f2',
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function toneColor(t: Theme, tone: Tone): string {
  return { ok: t.ok, info: t.info, warn: t.warn, bad: t.bad, muted: t.ink2 }[tone];
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, style]}>
      {title ? <Text style={[styles.cardTitle, { color: t.ink2 }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: t.line }]}>
      <Text style={[styles.rowLabel, { color: t.ink2 }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: tone ? toneColor(t, tone) : t.ink }]}>{value}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'plain',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'plain' | 'primary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.bad : t.card;
  const fg = kind === 'primary' ? t.onAccent : kind === 'danger' ? t.onBad : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'plain' ? t.line : bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, unit, ...input }: { label: string; unit?: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.ink2 }]}>
        {label}
        {unit ? ` (${unit})` : ''}
      </Text>
      <TextInput
        placeholderTextColor={t.ink2}
        {...input}
        style={[
          styles.input,
          { borderColor: t.line, color: t.ink, backgroundColor: t.bg, opacity: input.editable === false ? 0.6 : 1 },
          input.multiline ? { minHeight: 84, textAlignVertical: 'top' } : null,
        ]}
      />
    </View>
  );
}

export function Notice({ tone, text }: { tone: Tone; text: string }) {
  const t = useTheme();
  const c = toneColor(t, tone);
  const solid = tone === 'bad';
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: c, backgroundColor: solid ? c : 'transparent' }]}
    >
      <Text style={{ color: solid ? t.onBad : c, fontWeight: '700', fontSize: 15 }}>{text}</Text>
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: t.ink2, fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}

/** Small rounded status label. Colour is never the only signal: it always carries text. */
export function Chip({ label, tone = 'muted' }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const c = toneColor(t, tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: t.bg }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export type IconName = 'tank' | 'history' | 'control' | 'settings' | 'logbook' | 'about';

/** Line icons for the tab bar, drawn here so no icon font is needed. */
export function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  const line = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'tank' ? <Path {...line} d="M12 3C12 3 5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 3 12 3Z" /> : null}
      {name === 'history' ? <Path {...line} d="M4 20h16M4 16l5-5 4 3 7-8" /> : null}
      {name === 'control' ? <Path {...line} d="M12 4v8M7.5 7.5a7 7 0 1 0 9 0" /> : null}
      {name === 'settings' ? (
        <>
          <Path {...line} d="M4 7h9M19 7h1M4 17h1M11 17h9" />
          <Circle {...line} cx={16} cy={7} r={2.5} />
          <Circle {...line} cx={8} cy={17} r={2.5} />
        </>
      ) : null}
      {name === 'logbook' ? <Path {...line} d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1V4ZM9.5 8.5h5M9.5 12.5h5" /> : null}
      {name === 'about' ? (
        <>
          <Circle {...line} cx={12} cy={12} r={9} />
          <Path {...line} d="M12 11v5M12 7.6v.1" />
        </>
      ) : null}
    </Svg>
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  cardTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14, flexShrink: 0 },
  rowValue: { fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  button: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  notice: { borderWidth: 2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  screen: { padding: 16, gap: 14, paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
