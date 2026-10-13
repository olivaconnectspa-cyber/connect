import { Link } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { loadRouteHistory, type TodayRoute } from '@/lib/route-repository';
import { loadLocalRouteHistory, type LocalRouteHistory } from '@/lib/stops';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF' };
type HistoryEntry = { date: string; total: number; delivered: number; failed: number; pending: number };

function summarizeCloud(routes: TodayRoute[]): HistoryEntry[] {
  return routes.map((route) => ({
    date: route.date,
    total: route.deliveries.length,
    delivered: route.deliveries.filter((delivery) => delivery.status === 'delivered').length,
    failed: route.deliveries.filter((delivery) => delivery.status === 'failed').length,
    pending: route.deliveries.filter((delivery) => delivery.status === 'pending').length,
  }));
}

function summarizeLocal(routes: LocalRouteHistory[]): HistoryEntry[] {
  return routes.map((route) => ({
    date: route.date,
    total: route.stops.length,
    delivered: route.stops.filter((stop) => stop.status === 'delivered').length,
    failed: route.stops.filter((stop) => stop.status === 'failed').length,
    pending: route.stops.filter((stop) => !stop.status || stop.status === 'pending').length,
  }));
}

function displayDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HistoryScreen() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (currentUser: User | null) => {
    setLoading(true);
    setError('');
    try {
      const history = isFirebaseConfigured && currentUser
        ? summarizeCloud(await loadRouteHistory(currentUser.uid))
        : isFirebaseConfigured ? [] : summarizeLocal(await loadLocalRouteHistory());
      setEntries(history.filter((entry) => entry.total > 0));
    } catch {
      setError('No se pudo cargar el historial. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      void refresh(null);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      void refresh(nextUser);
    });
  }, [refresh]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/ruta" asChild><Pressable style={styles.backButton}><Text style={styles.backText}>‹  Volver a la ruta</Text></Pressable></Link>
        <Text style={styles.eyebrow}>TUS JORNADAS</Text>
        <Text style={styles.title}>Historial</Text>
        <Text style={styles.subtitle}>Consulta las paradas y los resultados de tus rutas anteriores.</Text>

        {isFirebaseConfigured && !user && <View style={styles.notice}><Text style={styles.body}>Inicia sesión para consultar el historial guardado en tu cuenta.</Text><Link href="/cuenta" asChild><Pressable><Text style={styles.link}>Ir a Cuenta →</Text></Pressable></Link></View>}
        {loading ? <Text style={styles.helper}>Cargando historial…</Text> : error ? <Text style={styles.error}>{error}</Text> : entries.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Todavía no hay rutas</Text><Text style={styles.body}>Cuando tengas paradas guardadas, aparecerán aquí agrupadas por día.</Text></View>
        ) : entries.map((entry) => (
          <View key={entry.date} style={styles.routeCard}>
            <Text style={styles.date}>{displayDate(entry.date)}</Text>
            <Text style={styles.total}>{entry.total} {entry.total === 1 ? 'parada' : 'paradas'}</Text>
            <View style={styles.stats}>
              <Text style={styles.delivered}>{entry.delivered} entregadas</Text>
              <Text style={styles.failed}>{entry.failed} fallidas</Text>
              <Text style={styles.pending}>{entry.pending} pendientes</Text>
            </View>
          </View>
        ))}
        {!isFirebaseConfigured && <Text style={styles.helper}>Este historial se guarda en este teléfono. Al iniciar sesión con Firebase, las nuevas rutas quedarán asociadas a tu cuenta.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 40, flexGrow: 1 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 },
  backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  routeCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 17, marginBottom: 10 },
  date: { color: colors.ink, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  total: { color: colors.muted, fontSize: 12, marginTop: 7 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  delivered: { color: colors.green, backgroundColor: '#EAF1E8', fontSize: 10, fontWeight: '600', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  failed: { color: '#94602B', backgroundColor: '#F8EFE3', fontSize: 10, fontWeight: '600', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  pending: { color: colors.muted, backgroundColor: colors.pale, fontSize: 10, fontWeight: '600', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  emptyCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 20, marginTop: 4 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 16 },
  notice: { backgroundColor: '#E7EDE3', borderRadius: 14, padding: 14, marginBottom: 14 },
  link: { color: colors.green, fontWeight: '700', marginTop: 8 },
  error: { color: '#A14337', fontSize: 12, lineHeight: 18, marginTop: 10 },
});
