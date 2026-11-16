// The list of units saved on this phone, shown as a sheet from the header.
// Tap a unit to switch to it. Access is still decided by Firebase: saving an
// ID here does not give this account any right to see that unit.
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { MAX_SAVED_UNITS, unitLabel, type SavedUnit } from '../logic';
import { Button, Muted, useTheme } from '../ui';

export function UnitSwitcher({
  visible,
  units,
  currentId,
  onClose,
  onSwitch,
  onAdd,
  onRemove,
}: {
  visible: boolean;
  units: SavedUnit[];
  currentId: string;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useTheme();
  // Removing takes two taps on the same row, so a slip does not drop a unit.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setConfirmId(null);
  }, [visible]);

  const full = units.length >= MAX_SAVED_UNITS;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close the list of units" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
      <View
        style={{
          backgroundColor: t.card,
          borderTopWidth: 1,
          borderTopColor: t.line,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: 16,
          gap: 10,
          maxHeight: '75%',
        }}
      >
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>
          Your units
        </Text>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {units.map((u) => {
            const on = u.id === currentId;
            const confirming = confirmId === u.id;
            return (
              <View
                key={u.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? t.accent : t.line,
                  borderRadius: 12,
                  backgroundColor: t.bg,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={on ? `${unitLabel(u)}, showing now` : `Switch to ${unitLabel(u)}`}
                  onPress={() => (on ? onClose() : onSwitch(u.id))}
                  style={({ pressed }) => ({ flex: 1, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
                    {unitLabel(u)}
                  </Text>
                  <Text style={{ color: on ? t.accent : t.ink2, fontSize: 13, fontWeight: on ? '700' : '400' }} numberOfLines={1}>
                    {on ? `Showing now · ${u.id}` : u.name ? u.id : 'Name appears after the first connection'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={confirming ? `Confirm: remove ${unitLabel(u)} from this phone` : `Remove ${unitLabel(u)} from this phone`}
                  onPress={() => (confirming ? onRemove(u.id) : setConfirmId(u.id))}
                  style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 14, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ color: confirming ? t.bad : t.ink2, fontSize: 13, fontWeight: confirming ? '800' : '500' }}>
                    {confirming ? 'Tap again to remove' : 'Remove'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <Button kind="primary" label="Add another unit" disabled={full} onPress={onAdd} />
        {full ? <Muted>{`This phone can keep ${MAX_SAVED_UNITS} units. Remove one to add another.`}</Muted> : null}
        <Muted>This list is kept on this phone only. Removing a unit here does not change the unit or who can see it.</Muted>
        <Button label="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}
