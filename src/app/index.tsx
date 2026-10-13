import { Link, useFocusEffect, type Href } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadStops } from '@/lib/stops';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { loadTodayRoute } from '@/lib/route-repository';

const colors = {
  ink: '#20352B',
  muted: '#718078',
  green: '#315E43',
  pale: '#F2F5EF',
  line: '#E5EAE3',
  white: '#FFFFFF',
  orange: '#D88C44',
};

export default function HomeScreen() {
  const [stopCount, setStopCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let isActive = true;
    async function updateCount(userId?: string) {
      try {
        const count = isFirebaseConfigured && userId
          ? (await loadTodayRoute(userId))?.deliveries.length ?? 0
          : isFirebaseConfigured ? 0 : (await loadStops()).length;
        if (isActive) setStopCount(count);
      } catch {
        if (isActive) setStopCount(0);
      }
    }
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, (user) => { void updateCount(user?.uid); });
      return () => { isActive = false; unsubscribe(); };
    }
    void updateCount();
    return () => { isActive = false; };
  }, []));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>O</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>Connect</Text>
            <Text style={styles.brandCaption}>RUTAS MÁS SIMPLES</Text>
          </View>
          <Link href="/cuenta" asChild>
            <Pressable style={styles.avatar} accessibilityLabel="Abrir cuenta">
              <Text style={styles.avatarText}>C</Text>
            </Pressable>
          </Link>
        </View>

        <Text style={styles.greeting}>Hola, conductor</Text>
        <Text style={styles.subtitle}>Tu jornada empieza con una ruta bien organizada.</Text>

        <View style={styles.routeCard}>
          <View style={styles.routeCardTop}>
            <View>
              <Text style={styles.cardEyebrow}>TU JORNADA</Text>
              <Text style={styles.routeTitle}>Tu ruta</Text>
            </View>
            <View style={styles.emptyCount}>
              <Text style={styles.emptyCountNumber}>{stopCount}</Text>
              <Text style={styles.emptyCountLabel}>{stopCount === 1 ? 'parada' : 'paradas'}</Text>
            </View>
          </View>
          <View style={styles.rule} />
          <Text style={styles.emptyText}>
            {stopCount === 0 ? 'Todavía no tienes paradas en esta ruta.' : `Tienes ${stopCount} ${stopCount === 1 ? 'parada' : 'paradas'} en tu lista.`}
          </Text>
          <Link href={'/ruta' as Href} asChild>
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>＋  Crear mi ruta</Text>
            </Pressable>
          </Link>
        </View>

        <Text style={styles.sectionTitle}>Accesos rápidos</Text>
        <Link href={'/ruta' as Href} asChild>
          <Pressable style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}>
            <View style={styles.actionIcon}><Text style={styles.actionIconText}>＋</Text></View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>Añadir paradas</Text>
              <Text style={styles.actionDescription}>Prepara las direcciones de tu jornada</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
        <View style={styles.actionCard}>
          <View style={[styles.actionIcon, styles.communityIcon]}><Text style={styles.actionIconText}>✦</Text></View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Datos de direcciones</Text>
            <Text style={styles.actionDescription}>Consejos útiles de la comunidad</Text>
          </View>
          <Text style={styles.comingSoon}>PRONTO</Text>
        </View>

        <View style={styles.tipCard}>
          <Text style={styles.tipLabel}>CONNECT</Text>
          <Text style={styles.tipText}>Cada entrega cuenta. Organiza tu día a tu ritmo.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 30 },
  brandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: colors.white, fontSize: 23, fontWeight: '700' },
  brandCopy: { marginLeft: 11, flex: 1 },
  brandName: { color: colors.ink, fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  brandCaption: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginTop: 3 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#DFE8DC', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.green, fontSize: 12, fontWeight: '700' },
  greeting: { color: colors.ink, fontSize: 27, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 22 },
  routeCard: { backgroundColor: colors.white, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.line },
  routeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardEyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  routeTitle: { color: colors.ink, fontSize: 21, fontWeight: '700', marginTop: 5 },
  emptyCount: { minWidth: 67, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.pale },
  emptyCountNumber: { color: colors.green, fontSize: 19, fontWeight: '700' },
  emptyCountLabel: { color: colors.muted, fontSize: 10, marginTop: 1 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  emptyText: { color: colors.muted, fontSize: 13, marginBottom: 17 },
  primaryButton: { minHeight: 48, backgroundColor: colors.green, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.78 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  actionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 17, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 10 },
  actionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' },
  communityIcon: { backgroundColor: '#F8EFE3' },
  actionIconText: { color: colors.green, fontSize: 22, fontWeight: '500' },
  actionCopy: { flex: 1, marginLeft: 12 },
  actionTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  actionDescription: { color: colors.muted, fontSize: 11, marginTop: 4 },
  chevron: { color: colors.muted, fontSize: 26, marginHorizontal: 4 },
  comingSoon: { color: colors.orange, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  tipCard: { backgroundColor: '#E7EDE3', borderRadius: 17, padding: 17, marginTop: 14 },
  tipLabel: { color: colors.green, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  tipText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 7 },
});
