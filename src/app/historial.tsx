import { Link } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { deleteRouteHistory, loadRouteHistory, updateRouteName, type TodayRoute } from '@/lib/route-repository';
import { DEFAULT_ROUTE_NAME, deleteLocalRoute, loadLocalRouteHistory, saveLocalRouteName, type LocalRouteHistory } from '@/lib/stops';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF' };
type HistoryEntry = { id: string; date: string; name: string; total: number; delivered: number; failed: number; pending: number; durationMs: number | null };

function summarizeCloud(routes: TodayRoute[]): HistoryEntry[] {
  return routes.map((route) => ({
    id: route.id,
    date: route.date,
    name: route.name,
    total: route.deliveries.length,
    delivered: route.deliveries.filter((delivery) => delivery.status === 'delivered').length,
    failed: route.deliveries.filter((delivery) => delivery.status === 'failed').length,
    pending: route.deliveries.filter((delivery) => delivery.status === 'pending').length,
    durationMs: route.startedAt !== null && route.completedAt !== null ? Math.max(0, route.completedAt - route.startedAt) : null,
  }));
}

function summarizeLocal(routes: LocalRouteHistory[]): HistoryEntry[] {
  return routes.map((route) => ({
    id: route.date,
    date: route.date,
    name: route.name,
    total: route.stops.length,
    delivered: route.stops.filter((stop) => stop.status === 'delivered').length,
    failed: route.stops.filter((stop) => stop.status === 'failed').length,
    pending: route.stops.filter((stop) => !stop.status || stop.status === 'pending').length,
    durationMs: route.startedAt !== null && route.completedAt !== null ? Math.max(0, route.completedAt - route.startedAt) : null,
  }));
}

function displayDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function displayDuration(durationMs: number | null) {
  if (durationMs === null) return null;
  const minutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0 && remaining === 0) return 'Menos de 1 min';
  return hours > 0 ? `${hours} h ${remaining} min` : `${remaining} min`;
}

export default function HistoryScreen() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [routeNames, setRouteNames] = useState<Record<string, string>>({});
  const [savingRouteId, setSavingRouteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const refresh = useCallback(async (currentUser: User | null) => {
    setLoading(true);
    setError('');
    try {
      const history = isFirebaseConfigured && currentUser
        ? summarizeCloud(await loadRouteHistory(currentUser.uid))
        : isFirebaseConfigured ? [] : summarizeLocal(await loadLocalRouteHistory());
      const nonEmpty = history.filter((entry) => entry.total > 0);
      setEntries(nonEmpty);
      setRouteNames(Object.fromEntries(nonEmpty.map((entry) => [entry.id, entry.name])));
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

  async function saveRouteName(entry: HistoryEntry) {
    if (savingRouteId) return;
    setSavingRouteId(entry.id);
    setNotice('');
    try {
      const name = routeNames[entry.id]?.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
      if (isFirebaseConfigured && user) await updateRouteName(user.uid, entry.id, name);
      else await saveLocalRouteName(name, entry.date);
      setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, name } : item));
      setRouteNames((current) => ({ ...current, [entry.id]: name }));
      setNotice(`Nombre de ruta guardado: ${name}`);
    } catch {
      setNotice('No se pudo guardar el nombre. Inténtalo de nuevo.');
    } finally {
      setSavingRouteId(null);
    }
  }

  function askDeleteRoute(entry: HistoryEntry) {
    Alert.alert('Eliminar ruta', `¿Seguro que quieres eliminar “${routeNames[entry.id] ?? entry.name}” del historial? Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar ruta', style: 'destructive', onPress: () => void deleteRoute(entry) },
    ]);
  }

  async function deleteRoute(entry: HistoryEntry) {
    if (savingRouteId) return;
    setSavingRouteId(entry.id);
    setNotice('');
    try {
      if (isFirebaseConfigured && user) await deleteRouteHistory(user.uid, entry.id);
      else if (isFirebaseConfigured) throw new Error('login-required');
      else await deleteLocalRoute(entry.date);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setRouteNames((current) => { const next = { ...current }; delete next[entry.id]; return next; });
      setSelectedRouteId(null);
      setNotice('Ruta eliminada del historial.');
    } catch {
      setNotice('No se pudo eliminar la ruta. Revisa tu conexión e inténtalo otra vez.');
    } finally {
      setSavingRouteId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/ruta" asChild><Pressable style={styles.backButton}><Text style={styles.backText}>‹  Volver a la ruta</Text></Pressable></Link>
        <Text style={styles.eyebrow}>TUS JORNADAS</Text>
        <Text style={styles.title}>Historial</Text>
        <Text style={styles.subtitle}>Consulta las paradas y los resultados de tus rutas anteriores.</Text>
        <Text style={styles.longPressHint}>Mantén presionada una ruta para seleccionarla y ver la opción de eliminar.</Text>
        {!!notice && <Text style={styles.noticeText}>{notice}</Text>}

        {isFirebaseConfigured && !user && <View style={styles.notice}><Text style={styles.body}>Inicia sesión para consultar el historial guardado en tu cuenta.</Text><Link href="/cuenta" asChild><Pressable><Text style={styles.link}>Ir a Cuenta →</Text></Pressable></Link></View>}
        {loading ? <Text style={styles.helper}>Cargando historial…</Text> : error ? <Text style={styles.error}>{error}</Text> : entries.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Todavía no hay rutas</Text><Text style={styles.body}>Cuando tengas paradas guardadas, aparecerán aquí agrupadas por día.</Text></View>
        ) : entries.map((entry) => (
          <Pressable key={entry.id} delayLongPress={500} onLongPress={() => setSelectedRouteId(entry.id)} style={[styles.routeCard, selectedRouteId === entry.id && styles.routeSelected]} accessibilityHint="Mantén presionado para seleccionar opciones de la ruta">
            <Text style={styles.date}>{displayDate(entry.date)}</Text>
            <View style={styles.nameRow}>
              <TextInput value={routeNames[entry.id] ?? entry.name} onChangeText={(value) => setRouteNames((current) => ({ ...current, [entry.id]: value }))} placeholder="Nombre de esta ruta" placeholderTextColor="#91A098" style={styles.nameInput} maxLength={60} returnKeyType="done" onSubmitEditing={() => void saveRouteName(entry)} />
              <Pressable style={styles.saveButton} onPress={() => void saveRouteName(entry)} disabled={savingRouteId !== null}><Text style={styles.saveButtonText}>{savingRouteId === entry.id ? '…' : 'Guardar'}</Text></Pressable>
            </View>
            <Text style={styles.total}>{entry.total} {entry.total === 1 ? 'parada' : 'paradas'}</Text>
            <View style={styles.stats}>
              <Text style={styles.delivered}>{entry.delivered} entregadas</Text>
              <Text style={styles.failed}>{entry.failed} fallidas</Text>
              <Text style={styles.pending}>{entry.pending} pendientes</Text>
            </View>
            {displayDuration(entry.durationMs) && <Text style={styles.duration}>Duración de la jornada: {displayDuration(entry.durationMs)}</Text>}
            {selectedRouteId === entry.id && <View style={styles.selectionActions}>
              <Text style={styles.selectionText}>Ruta seleccionada</Text>
              <Pressable style={styles.cancelSelection} onPress={() => setSelectedRouteId(null)}><Text style={styles.cancelSelectionText}>Cancelar</Text></Pressable>
              <Pressable style={styles.deleteRouteButton} onPress={() => askDeleteRoute(entry)} disabled={savingRouteId !== null}><Text style={styles.deleteRouteText}>{savingRouteId === entry.id ? 'Eliminando…' : 'Eliminar'}</Text></Pressable>
            </View>}
          </Pressable>
        ))}
        {!isFirebaseConfigured && <Text style={styles.helper}>Este historial se guarda en este teléfono. Al iniciar sesión con Firebase, las nuevas rutas quedarán asociadas a tu cuenta.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116, flexGrow: 1 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 },
  backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  longPressHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -13, marginBottom: 15 },
  routeCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 17, marginBottom: 10 },
  routeSelected: { borderColor: colors.green, backgroundColor: '#F7FAF5' },
  date: { color: colors.ink, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  nameInput: { flex: 1, minHeight: 42, borderBottomWidth: 1, borderBottomColor: colors.line, color: colors.ink, fontSize: 13, paddingVertical: 4 },
  saveButton: { backgroundColor: '#EAF1E8', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  saveButtonText: { color: colors.green, fontWeight: '700', fontSize: 11 },
  noticeText: { color: colors.green, fontSize: 12, marginBottom: 12 },
  total: { color: colors.muted, fontSize: 12, marginTop: 7 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  duration: { color: colors.ink, fontSize: 11, fontWeight: '600', marginTop: 12 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 13, paddingTop: 12, gap: 9 },
  selectionText: { flex: 1, color: colors.green, fontSize: 11, fontWeight: '700' },
  cancelSelection: { paddingHorizontal: 10, paddingVertical: 8 },
  cancelSelectionText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  deleteRouteButton: { backgroundColor: '#F8EFE3', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 8 },
  deleteRouteText: { color: '#94602B', fontSize: 11, fontWeight: '700' },
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
