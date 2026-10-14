import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_ROUTE_NAME, getLocalRouteDate, loadLocalRouteId, loadLocalRouteName, loadStops, saveLocalRouteName } from '@/lib/stops';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { loadTodayRoute, updateTodayRouteName } from '@/lib/route-repository';

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
  const router = useRouter();
  const [routeName, setRouteName] = useState(DEFAULT_ROUTE_NAME);
  const [savedRouteName, setSavedRouteName] = useState(DEFAULT_ROUTE_NAME);
  const [routeStats, setRouteStats] = useState({ total: 0, delivered: 0, pending: 0, failed: 0 });
  const [routeId, setRouteId] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState('');

  useEffect(() => {
    if (!auth || !isFirebaseConfigured) return;
    return onAuthStateChanged(auth, (user) => {
      if (!user || !user.emailVerified) router.replace('/cuenta');
    });
  }, [router]);

  useFocusEffect(useCallback(() => {
    let isActive = true;
    async function updateDashboard(userId?: string) {
      try {
        if (isFirebaseConfigured && userId) {
          const route = await loadTodayRoute(userId);
          const deliveries = route?.deliveries ?? [];
          if (isActive) {
            setRouteId(route?.id ?? null);
            setRouteName(route?.name ?? DEFAULT_ROUTE_NAME);
            setSavedRouteName(route?.name ?? DEFAULT_ROUTE_NAME);
            setRouteStats({
              total: deliveries.length,
              delivered: deliveries.filter((item) => item.status === 'delivered').length,
              pending: deliveries.filter((item) => item.status === 'pending').length,
              failed: deliveries.filter((item) => item.status === 'failed').length,
            });
          }
        } else if (isFirebaseConfigured) {
          if (isActive) {
            setRouteId(null);
            setRouteName(DEFAULT_ROUTE_NAME);
            setSavedRouteName(DEFAULT_ROUTE_NAME);
            setRouteStats({ total: 0, delivered: 0, pending: 0, failed: 0 });
          }
        } else {
          const localRouteId = await loadLocalRouteId();
          const [stops, name] = await Promise.all([loadStops(localRouteId), loadLocalRouteName(localRouteId)]);
          if (isActive) {
            setRouteId(localRouteId);
            setRouteName(name);
            setSavedRouteName(name);
            setRouteStats({
              total: stops.length,
              delivered: stops.filter((item) => item.status === 'delivered').length,
              pending: stops.filter((item) => !item.status || item.status === 'pending').length,
              failed: stops.filter((item) => item.status === 'failed').length,
            });
          }
        }
      } catch {
        if (isActive) {
          setRouteStats({ total: 0, delivered: 0, pending: 0, failed: 0 });
          setNameMessage('No se pudo actualizar el resumen de la ruta.');
        }
      }
    }
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, (user) => { void updateDashboard(user?.uid); });
      return () => { isActive = false; unsubscribe(); };
    }
    void updateDashboard();
    return () => { isActive = false; };
  }, []));

  async function saveRouteName() {
    const cleanName = routeName.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
    setRouteName(cleanName);
    if (cleanName === savedRouteName || savingName) return;
    setSavingName(true);
    setNameMessage('');
    try {
      if (isFirebaseConfigured) {
        const currentUser = auth?.currentUser;
        if (!currentUser) {
          setNameMessage('Inicia sesión para guardar el nombre en tu cuenta.');
          setRouteName(savedRouteName);
          return;
        }
        await updateTodayRouteName(currentUser.uid, cleanName, routeId ?? undefined);
      } else {
        await saveLocalRouteName(cleanName, routeId ?? undefined);
      }
      setSavedRouteName(cleanName);
      setNameMessage('Nombre guardado');
    } catch {
      setRouteName(savedRouteName);
      setNameMessage('No se pudo guardar el nombre. Inténtalo otra vez.');
    } finally {
      setSavingName(false);
    }
  }

  const dateLabel = new Date(`${getLocalRouteDate()}T12:00:00`).toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Image source={require('../../assets/images/icon.png')} style={styles.brandMark} contentFit="contain" accessibilityLabel="Logo de Connect" />
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

        <Text style={styles.greeting}>{routeStats.total === 0 ? 'Nuevo día, conductor' : 'Tu ruta de hoy'}</Text>
        <Text style={styles.subtitle}>{routeStats.total === 0 ? 'Prepara tu jornada y organiza las entregas.' : 'Sigue el avance de tus entregas de hoy.'}</Text>

        <View style={styles.routeCard}>
          <Text style={styles.cardEyebrow}>{routeStats.total === 0 ? 'NUEVA JORNADA' : 'RUTA DE HOY'}</Text>
          <Text style={styles.routeDate}>{dateLabel}</Text>
          <View style={styles.routeNameRow}>
            <TextInput
              value={routeName}
              onChangeText={(value) => { setRouteName(value); setNameMessage(''); }}
              onBlur={() => { void saveRouteName(); }}
              onSubmitEditing={() => { Keyboard.dismiss(); void saveRouteName(); }}
              returnKeyType="done"
              maxLength={60}
              placeholder="Escribe el nombre de tu ruta"
              placeholderTextColor="#91A098"
              style={styles.routeNameInput}
              accessibilityLabel="Nombre de la ruta de hoy"
            />
            <Text style={styles.editIcon}>✎</Text>
          </View>
          <Text style={styles.nameMessage}>{savingName ? 'Guardando…' : nameMessage || 'Toca para ponerle un nombre'}</Text>
          <View style={styles.rule} />
          <View style={styles.routeStats}>
            <View style={styles.statBox}><Text style={styles.statValue}>{routeStats.total}</Text><Text style={styles.statLabel}>Total</Text></View>
            <View style={styles.statBox}><Text style={[styles.statValue, styles.deliveredValue]}>{routeStats.delivered}</Text><Text style={styles.statLabel}>Entregadas</Text></View>
            <View style={styles.statBox}><Text style={[styles.statValue, styles.pendingValue]}>{routeStats.pending}</Text><Text style={styles.statLabel}>Pendientes</Text></View>
            <View style={styles.statBox}><Text style={[styles.statValue, styles.failedValue]}>{routeStats.failed}</Text><Text style={styles.statLabel}>Fallidas</Text></View>
          </View>
          <Text style={styles.emptyText}>{routeStats.total === 0 ? 'Todavía no tienes paradas en la ruta de hoy.' : 'Resumen actualizado al volver de tu ruta.'}</Text>
          <Link href={'/ruta' as Href} asChild>
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{routeStats.total === 0 ? '＋  Empezar nuevo día' : 'Ver ruta de hoy'}</Text>
            </Pressable>
          </Link>
        </View>

        <Text style={styles.sectionTitle}>Accesos rápidos</Text>
        <Link href={'/historial' as Href} asChild>
          <Pressable style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}>
            <View style={styles.actionIcon}><Text style={styles.actionIconText}>↻</Text></View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>Ver todas mis rutas</Text>
              <Text style={styles.actionDescription}>Consulta y renombra tus jornadas anteriores</Text>
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
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 30 },
  brandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.green },
  brandCopy: { marginLeft: 11, flex: 1 },
  brandName: { color: colors.ink, fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  brandCaption: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginTop: 3 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#DFE8DC', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.green, fontSize: 12, fontWeight: '700' },
  greeting: { color: colors.ink, fontSize: 27, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 22 },
  routeCard: { backgroundColor: colors.white, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.line },
  cardEyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  routeDate: { color: colors.muted, fontSize: 12, textTransform: 'capitalize', marginTop: 6 },
  routeNameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  routeNameInput: { flex: 1, color: colors.ink, fontSize: 20, fontWeight: '700', minHeight: 40, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: colors.line },
  editIcon: { color: colors.green, fontSize: 18, marginLeft: 10 },
  nameMessage: { color: colors.muted, fontSize: 9, marginTop: 5, minHeight: 12 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  routeStats: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  statBox: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 13, backgroundColor: colors.pale },
  statValue: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  deliveredValue: { color: colors.green },
  pendingValue: { color: '#94602B' },
  failedValue: { color: '#A14337' },
  statLabel: { color: colors.muted, fontSize: 8, marginTop: 4, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 11, marginTop: 13, marginBottom: 15 },
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
