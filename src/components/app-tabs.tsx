import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import type { Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', line: '#E5EAE3', white: '#FFFFFF', selected: '#EAF1E8' };

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <View style={[styles.barPosition, { bottom: Math.max(insets.bottom, 8) + 8 }]}>
          <View style={styles.bar}>
            <TabTrigger name="index" href="/" asChild><TabButton>Inicio</TabButton></TabTrigger>
            <TabTrigger name="ruta" href={'/ruta' as Href} asChild><TabButton>Ruta</TabButton></TabTrigger>
            <TabTrigger name="cuenta" href="/cuenta" asChild><TabButton>Cuenta</TabButton></TabTrigger>
            <TabTrigger name="historial" href={'/historial' as Href} asChild><TabButton>Historial</TabButton></TabTrigger>
          </View>
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [styles.tabButton, isFocused && styles.selectedTab, pressed && styles.pressed]}>
      <Text style={[styles.tabText, isFocused && styles.selectedText]} numberOfLines={1}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  barPosition: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12 },
  bar: { width: '100%', maxWidth: 560, flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 5, elevation: 8, shadowColor: '#1D3226', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  tabButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingHorizontal: 3 },
  selectedTab: { backgroundColor: colors.selected },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  selectedText: { color: colors.green, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
