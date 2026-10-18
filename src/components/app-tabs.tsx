import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { useAppPreferences } from '@/lib/app-preferences';

const colors = {
  ink: '#20352B',
  muted: '#718078',
  green: '#315E43',
  line: '#E5EAE3',
  white: '#FFFFFF',
  selected: '#EAF1E8',
};

export default function AppTabs() {
  const systemScheme = useColorScheme();
  const { theme } = useAppPreferences();
  const dark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const [userReady, setUserReady] = useState(!auth);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => {
      setIsVerified(Boolean(user?.emailVerified));
      setUserReady(true);
    });
  }, []);

  if (!userReady) return <View style={[styles.loading, dark && styles.darkLoading]}><ActivityIndicator color={dark ? '#A6D2B1' : colors.green} /><Text style={[styles.loadingText, dark && styles.darkLoadingText]}>Cargando Connect…</Text></View>;

  return (
    <Tabs
      initialRouteName={isFirebaseConfigured && !isVerified ? 'cuenta' : 'index'}
      tabBar={(props) => <FloatingTabBar {...props} accountOnly={isFirebaseConfigured && !isVerified} dark={dark} />}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="ruta" options={{ title: 'Ruta' }} />
      <Tabs.Screen name="historial" options={{ title: 'Historial' }} />
      <Tabs.Screen name="cuenta" options={{ title: 'Cuenta' }} />
      <Tabs.Screen name="planes" options={{ href: null }} />
      <Tabs.Screen name="direcciones" options={{ href: null }} />
      <Tabs.Screen name="ruta-compartida" options={{ href: null, title: 'Ruta compartida' }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}

function FloatingTabBar({ state, descriptors, navigation, insets, accountOnly, dark }: BottomTabBarProps & { accountOnly: boolean; dark: boolean }) {
  const visibleRoutes = state.routes.filter((route) => route.name !== 'explore' && route.name !== 'planes' && (!accountOnly || route.name === 'cuenta'));

  return (
    <View pointerEvents="box-none" style={[styles.barPosition, { bottom: Math.max(insets.bottom, 8) + 8 }]}>
      <View style={[styles.bar, dark && styles.darkBar]}>
        {visibleRoutes.map((route) => {
          const options = descriptors[route.key]?.options;
          const focused = state.routes[state.index]?.key === route.key;
          const label = typeof options?.tabBarLabel === 'string'
            ? options.tabBarLabel
            : options?.title ?? route.name;

          return (
            <TabButton
              key={route.key}
              label={label}
              focused={focused}
              dark={dark}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabButton({ label, focused, dark, onPress }: { label: string; focused: boolean; dark: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.96)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.96,
      useNativeDriver: true,
      damping: 15,
      stiffness: 180,
    }).start();
  }, [focused, scale]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, damping: 14 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: focused ? 1 : 0.96, useNativeDriver: true, damping: 14 }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={styles.tabHitArea}>
      <Animated.View style={[styles.tabButton, dark && styles.darkTabButton, focused && (dark ? styles.darkSelectedTab : styles.selectedTab), { transform: [{ scale }] }]}>
        <Text style={[styles.tabText, dark && styles.darkTabText, focused && (dark ? styles.darkSelectedText : styles.selectedText)]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F5EF' },
  loadingText: { color: colors.muted, fontSize: 12, marginTop: 12 },
  darkLoading: { backgroundColor: '#111A15' },
  darkLoadingText: { color: '#A8B8AD' },
  barPosition: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12, zIndex: 20, elevation: 12 },
  bar: { width: '100%', maxWidth: 560, flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 5, elevation: 8, shadowColor: '#1D3226', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  tabHitArea: { flex: 1 },
  tabButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingHorizontal: 3 },
  selectedTab: { backgroundColor: colors.selected },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  selectedText: { color: colors.green, fontWeight: '700' },
  darkBar: { backgroundColor: '#1C2921', borderColor: '#34453A' },
  darkTabButton: { backgroundColor: '#1C2921' },
  darkSelectedTab: { backgroundColor: '#2A4534' },
  darkTabText: { color: '#A8B8AD' },
  darkSelectedText: { color: '#A6D2B1', fontWeight: '700' },
});
