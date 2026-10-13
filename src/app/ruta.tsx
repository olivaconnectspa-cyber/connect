import { Link } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDeliveryToTodayRoute, loadTodayRoute, removeDeliveryFromTodayRoute, updateDeliveryStatus, type Delivery } from '@/lib/route-repository';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { loadStops, saveStops, type Stop } from '@/lib/stops';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', red: '#A14337' };

export default function RouteScreen() {
  const [address, setAddress] = useState('');
  const [stops, setStops] = useState<Delivery[]>([]);
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [storageError, setStorageError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failureId, setFailureId] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState('');

  const refresh = useCallback(async (currentUser: User | null) => {
    setIsLoading(true);
    setStorageError('');
    try {
      if (!isFirebaseConfigured) {
        const localStops = await loadStops();
        setStops(localStops.map((stop, index) => ({
          id: stop.id, address: stop.address, sequence: index + 1,
          status: stop.status ?? 'pending', failureReason: stop.failureReason ?? null, proofPhotoUrl: null,
        })));
      } else if (currentUser) {
        const route = await loadTodayRoute(currentUser.uid);
        setStops(route?.deliveries ?? []);
      } else {
        setStops([]);
      }
    } catch {
      setStorageError('No se pudo cargar la ruta. Revisa tu conexión y vuelve a intentarlo.');
    } finally {
      setIsLoading(false);
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

  async function persistLocal(nextStops: Delivery[]) {
    const localStops: Stop[] = nextStops.map((stop) => ({
      id: stop.id, address: stop.address, createdAt: new Date().toISOString(),
      status: stop.status, failureReason: stop.failureReason,
    }));
    await saveStops(localStops);
  }

  async function addStop() {
    const trimmedAddress = address.trim();
    if (!trimmedAddress || busy) return;
    setBusy(true);
    setStorageError('');
    try {
      if (isFirebaseConfigured && user) {
        const created = await addDeliveryToTodayRoute(user.uid, trimmedAddress);
        setStops((current) => [...current, created]);
      } else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión en Cuenta para guardar tus paradas en la nube.');
        return;
      } else {
        const created: Delivery = { id: `${Date.now()}`, address: trimmedAddress, sequence: stops.length + 1, status: 'pending', failureReason: null, proofPhotoUrl: null };
        const next = [...stops, created];
        await persistLocal(next);
        setStops(next);
      }
      setAddress('');
    } catch {
      setStorageError('No se pudo guardar la parada. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function removeStop(stopId: string) {
    if (busy) return;
    setBusy(true);
    setStorageError('');
    try {
      const next = stops.filter((stop) => stop.id !== stopId);
      if (isFirebaseConfigured && user) await removeDeliveryFromTodayRoute(user.uid, stopId);
      else await persistLocal(next);
      setStops(next.map((stop, index) => ({ ...stop, sequence: index + 1 })));
    } catch {
      setStorageError('No se pudo eliminar la parada. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  }

  async function markDelivered(stop: Delivery) {
    if (busy) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'delivered' as const, failureReason: null } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'delivered');
      else await persistLocal(next);
      setStops(next);
    } catch {
      setStorageError('No se pudo actualizar la entrega. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function markFailed(stop: Delivery) {
    const reason = failureReason.trim();
    if (!reason || busy) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'failed' as const, failureReason: reason } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'failed', reason);
      else await persistLocal(next);
      setStops(next);
      setFailureId(null);
      setFailureReason('');
    } catch {
      setStorageError('No se pudo guardar el motivo. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPending(stop: Delivery) {
    if (busy) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'pending' as const, failureReason: null } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'pending');
      else await persistLocal(next);
      setStops(next);
    } catch {
      setStorageError('No se pudo actualizar la entrega. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href="/" asChild><Pressable style={styles.backButton}><Text style={styles.backText}>‹  Inicio</Text></Pressable></Link>
        <Text style={styles.eyebrow}>PLANIFICACIÓN</Text>
        <Text style={styles.title}>Tu ruta</Text>
        <Text style={styles.subtitle}>Agrega direcciones y registra el resultado de cada entrega.</Text>

        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>DIRECCIÓN DE LA PARADA</Text>
          <TextInput value={address} onChangeText={setAddress} placeholder="Ej.: Av. Los Olivos 123, Santiago" placeholderTextColor="#91A098" style={styles.input} returnKeyType="done" onSubmitEditing={addStop} />
          <Pressable style={[styles.addButton, (isLoading || busy) && styles.disabledButton]} onPress={addStop} disabled={isLoading || busy}>
            <Text style={styles.addButtonText}>{busy ? 'Guardando…' : '＋  Añadir parada'}</Text>
          </Pressable>
        </View>

        {isFirebaseConfigured && !user && <View style={styles.accountNotice}><Text style={styles.accountText}>Inicia sesión para guardar y consultar tus rutas en Firebase.</Text><Link href="/cuenta" asChild><Pressable><Text style={styles.accountLink}>Ir a Cuenta →</Text></Pressable></Link></View>}
        <Text style={styles.listHeading}>Paradas de hoy <Text style={styles.stopCount}>{stops.length}</Text></Text>
        {isLoading ? <Text style={styles.helper}>Cargando ruta…</Text> : stops.length === 0 ? (
          <View style={styles.emptyCard}><View style={styles.pin}><Text style={styles.pinText}>⌖</Text></View><Text style={styles.emptyTitle}>Tu lista está vacía</Text><Text style={styles.emptyDescription}>Escribe una dirección arriba para empezar.</Text></View>
        ) : stops.map((stop, index) => (
          <View key={stop.id} style={styles.stopCard}>
            <View style={styles.stopTop}>
              <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{index + 1}</Text></View>
              <Text style={styles.stopAddress}>{stop.address}</Text>
              <Pressable onPress={() => removeStop(stop.id)} hitSlop={10} accessibilityLabel={`Eliminar parada ${index + 1}`}><Text style={styles.removeStop}>×</Text></Pressable>
            </View>
            <Text style={[styles.status, stop.status === 'delivered' && styles.delivered, stop.status === 'failed' && styles.failed]}>
              {stop.status === 'delivered' ? 'Entregada' : stop.status === 'failed' ? `Fallida · ${stop.failureReason ?? ''}` : 'Pendiente'}
            </Text>
            {stop.status === 'pending' ? <View style={styles.actions}>
              <Pressable style={styles.deliveredButton} onPress={() => markDelivered(stop)}><Text style={styles.deliveredButtonText}>Marcar entregada</Text></Pressable>
              <Pressable style={styles.failedButton} onPress={() => { setFailureId(failureId === stop.id ? null : stop.id); setFailureReason(''); }}><Text style={styles.failedButtonText}>Fallida</Text></Pressable>
            </View> : <Pressable onPress={() => resetPending(stop)}><Text style={styles.resetLink}>Volver a pendiente</Text></Pressable>}
            {failureId === stop.id && <View style={styles.failureForm}><TextInput value={failureReason} onChangeText={setFailureReason} placeholder="Motivo de la entrega fallida" placeholderTextColor="#91A098" style={styles.reasonInput} maxLength={300} /><Pressable style={styles.failedButton} onPress={() => markFailed(stop)}><Text style={styles.failedButtonText}>Guardar motivo</Text></Pressable></View>}
          </View>
        ))}
        {!isFirebaseConfigured && <View style={styles.note}><Text style={styles.noteTitle}>Guardadas en este teléfono</Text><Text style={styles.noteText}>Cuando configures Firebase, estas paradas locales seguirán disponibles aquí y las nuevas se guardarán en tu cuenta.</Text></View>}
        {!!storageError && <Text style={styles.errorText}>{storageError}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale }, content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 40, flexGrow: 1 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 }, backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }, title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  inputCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, marginTop: 24 }, inputLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }, input: { minHeight: 48, color: colors.ink, fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 14 },
  addButton: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 14, marginTop: 16 }, disabledButton: { opacity: 0.55 }, addButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  accountNotice: { backgroundColor: '#E7EDE3', borderRadius: 14, padding: 14, marginTop: 16 }, accountText: { color: colors.ink, fontSize: 12, lineHeight: 18 }, accountLink: { color: colors.green, fontWeight: '700', marginTop: 8 },
  listHeading: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 25, marginBottom: 10 }, stopCount: { color: colors.green, fontWeight: '700' }, helper: { color: colors.muted, padding: 12 },
  emptyCard: { minHeight: 185, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 3, backgroundColor: colors.white, borderRadius: 22, borderWidth: 1, borderColor: colors.line }, pin: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center', marginBottom: 17 }, pinText: { color: colors.green, fontSize: 30 }, emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' }, emptyDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  stopCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 8 }, stopTop: { flexDirection: 'row', alignItems: 'center' }, stopNumber: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }, stopNumberText: { color: colors.green, fontSize: 12, fontWeight: '700' }, stopAddress: { color: colors.ink, flex: 1, fontSize: 13, marginLeft: 11 }, removeStop: { color: colors.muted, fontSize: 23, paddingHorizontal: 5 },
  status: { color: colors.muted, fontSize: 11, fontWeight: '600', marginLeft: 41, marginTop: 7 }, delivered: { color: colors.green }, failed: { color: colors.red }, actions: { flexDirection: 'row', gap: 8, marginLeft: 41, marginTop: 10 }, deliveredButton: { backgroundColor: '#EAF1E8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }, deliveredButtonText: { color: colors.green, fontSize: 11, fontWeight: '700' }, failedButton: { backgroundColor: '#F8EFE3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }, failedButtonText: { color: '#94602B', fontSize: 11, fontWeight: '700' }, resetLink: { color: colors.green, fontSize: 11, fontWeight: '700', marginLeft: 41, marginTop: 10 }, failureForm: { marginLeft: 41, marginTop: 8 }, reasonInput: { minHeight: 42, borderBottomWidth: 1, borderBottomColor: colors.line, color: colors.ink, fontSize: 12, marginBottom: 8 },
  note: { backgroundColor: '#E7EDE3', borderRadius: 16, padding: 16, marginTop: 14 }, noteTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' }, noteText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }, errorText: { color: colors.red, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
