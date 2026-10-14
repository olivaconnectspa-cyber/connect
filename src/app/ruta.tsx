import { Link, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDeliveryToTodayRoute, completeTodayRoute, incrementDeliveryRecordCount, loadTodayRoute, markTodayRouteStarted, removeDeliveryFromTodayRoute, updateDeliveryNote, updateDeliveryOrder, updateDeliveryStatus, type Delivery } from '@/lib/route-repository';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { finishLocalRoute, loadLocalRouteTiming, loadStops, saveLocalRouteStartedAt, saveStops, type Stop } from '@/lib/stops';
import { normalizeDeliveryAddress, parseAddressRows, parseCsvAddresses, type ImportedAddress } from '@/lib/csv';
import RouteMap from '@/components/route-map';
import { clearNextStopNotification, prepareRouteNotifications, ROUTE_NOTIFICATION_ACTIONS, showNextStopNotification } from '@/lib/route-notifications';
import { addNotificationResponseReceivedListener } from 'expo-notifications/build/NotificationsEmitter';
import { useAppPreferences } from '@/lib/app-preferences';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', red: '#A14337' };
type NavigationProvider = 'google' | 'waze' | 'inside';
type RouteSummary = { elapsedMs: number; delivered: number; failed: number; pending: number };

function formatElapsed(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0 && remainingMinutes === 0) return 'Menos de 1 minuto';
  if (hours === 0) return `${remainingMinutes} min`;
  return `${hours} h ${remainingMinutes} min`;
}

export default function RouteScreen() {
  const { map: savedMap, ready: preferencesReady, setMap } = useAppPreferences();
  const [address, setAddress] = useState('');
  const [stops, setStops] = useState<Delivery[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [routeStarted, setRouteStarted] = useState(false);
  const [routeStartedAt, setRouteStartedAt] = useState<number | null>(null);
  const [routeFinished, setRouteFinished] = useState(false);
  const [stopListExpanded, setStopListExpanded] = useState(false);
  const [visitedStopsExpanded, setVisitedStopsExpanded] = useState(false);
  const [nextStopNotice, setNextStopNotice] = useState('');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [navigationProvider, setNavigationProvider] = useState<NavigationProvider>('inside');
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [storageError, setStorageError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [failureId, setFailureId] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState('');
  const [importPreview, setImportPreview] = useState<ImportedAddress[] | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastOffset = useRef(new Animated.Value(-18)).current;
  const summaryScale = useRef(new Animated.Value(0.75)).current;
  const summaryOpacity = useRef(new Animated.Value(0)).current;
  const nextStopNoticeOpacity = useRef(new Animated.Value(0)).current;
  const nextStopNoticeOffset = useRef(new Animated.Value(10)).current;
  const nextStopNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (preferencesReady) setNavigationProvider(savedMap);
  }, [preferencesReady, savedMap]);

  useEffect(() => {
    if (!storageError) return;
    toastOpacity.setValue(0);
    toastOffset.setValue(-18);
    Animated.parallel([
      Animated.timing(toastOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(toastOffset, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 180 }),
    ]).start();
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(toastOffset, { toValue: -18, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setStorageError('');
      });
    }, 5000);
    return () => clearTimeout(timeout);
  }, [storageError, toastOffset, toastOpacity]);

  const refresh = useCallback(async (currentUser: User | null) => {
    setIsLoading(true);
    setStorageError('');
    try {
      if (!isFirebaseConfigured) {
        const localStops = await loadStops();
        const timing = await loadLocalRouteTiming();
        const loaded = localStops.map((stop, index) => ({
          id: stop.id, address: stop.address, sequence: stop.sequence ?? index + 1, displayNumber: stop.displayNumber ?? String(stop.sequence ?? index + 1),
          status: stop.status ?? 'pending', failureReason: stop.failureReason ?? null, proofPhotoUrl: null,
          customerCount: stop.customerCount ?? 0, recordCount: stop.recordCount ?? stop.packageCount ?? 0, note: stop.note ?? '',
        })).sort((left, right) => left.sequence - right.sequence);
        setStops(loaded);
        setActiveStopId(loaded.find((stop) => stop.status === 'pending')?.id ?? null);
        setRouteStartedAt(timing.startedAt);
        setRouteFinished(Boolean(timing.completedAt));
        setRouteStarted(Boolean(timing.startedAt && !timing.completedAt));
      } else if (currentUser) {
        const route = await loadTodayRoute(currentUser.uid);
        const loaded = route?.deliveries ?? [];
        setStops(loaded);
        setActiveStopId(loaded.find((stop) => stop.status === 'pending')?.id ?? null);
        setRouteStartedAt(route?.startedAt ?? null);
        setRouteFinished(route?.status === 'completed');
        setRouteStarted(Boolean(route?.startedAt && route.status !== 'completed'));
      } else {
        setStops([]);
        setActiveStopId(null);
        setRouteStartedAt(null);
        setRouteStarted(false);
        setRouteFinished(false);
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

  useFocusEffect(useCallback(() => {
    void refresh(user);
  }, [refresh, user]));

  const displayedStops = useMemo(() => [...stops].sort((left, right) => {
    const leftVisited = left.status !== 'pending';
    const rightVisited = right.status !== 'pending';
    if (leftVisited !== rightVisited) return leftVisited ? 1 : -1;
    if (!leftVisited && !rightVisited) {
      if (left.id === activeStopId) return -1;
      if (right.id === activeStopId) return 1;
    }
    return left.sequence - right.sequence;
  }), [activeStopId, stops]);
  const pendingStops = useMemo(() => displayedStops.filter((stop) => stop.status === 'pending'), [displayedStops]);
  const visitedStops = useMemo(() => displayedStops.filter((stop) => stop.status !== 'pending'), [displayedStops]);
  const activeStop = stops.find((stop) => stop.id === activeStopId && stop.status === 'pending') ?? pendingStops[0] ?? null;
  const visibleStops = routeFinished ? [...pendingStops, ...(visitedStopsExpanded ? visitedStops : [])] : displayedStops;

  function showNextStopNotice(message: string) {
    if (nextStopNoticeTimer.current) clearTimeout(nextStopNoticeTimer.current);
    setNextStopNotice(message);
    nextStopNoticeOpacity.setValue(0);
    nextStopNoticeOffset.setValue(10);
    Animated.parallel([
      Animated.timing(nextStopNoticeOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(nextStopNoticeOffset, { toValue: 0, useNativeDriver: true, damping: 15, stiffness: 190 }),
    ]).start();
    nextStopNoticeTimer.current = setTimeout(() => {
      Animated.timing(nextStopNoticeOpacity, { toValue: 0, duration: 230, useNativeDriver: true }).start();
    }, 1900);
  }

  useEffect(() => {
    if (!routeStarted) {
      void clearNextStopNotification();
      return;
    }
    const active = stops.find((stop) => stop.id === activeStopId && stop.status === 'pending') ?? null;
    void showNextStopNotification(active);
  }, [activeStopId, routeStarted, stops]);

  useEffect(() => {
    const subscription = addNotificationResponseReceivedListener((response) => {
      const action = response.actionIdentifier;
      if (action === ROUTE_NOTIFICATION_ACTIONS.open || action === 'expo.modules.notifications.actions.DEFAULT') return;
      const stopId = response.notification.request.content.data?.stopId;
      if (typeof stopId !== 'string') return;
      const stop = stops.find((item) => item.id === stopId && item.status === 'pending');
      if (!stop) return;
      if (action === ROUTE_NOTIFICATION_ACTIONS.delivered) void markDelivered(stop);
      if (action === ROUTE_NOTIFICATION_ACTIONS.failed) void markFailed(stop, 'Marcada fallida desde la notificación.');
    });
    return () => subscription.remove();
  }, [stops, busy, routeStarted, navigationProvider]);

  async function persistLocal(nextStops: Delivery[]) {
    const localStops: Stop[] = nextStops.map((stop) => ({
      id: stop.id, address: stop.address, createdAt: new Date().toISOString(), sequence: stop.sequence, displayNumber: stop.displayNumber,
      status: stop.status, failureReason: stop.failureReason, customerCount: stop.customerCount ?? 0,
      recordCount: stop.recordCount ?? 0, note: stop.note ?? '',
    }));
    await saveStops(localStops);
  }

  async function addStop() {
    const trimmedAddress = address.trim();
    if (routeFinished) {
      setStorageError('Esta jornada ya terminó. Podrás iniciar una nueva ruta mañana.');
      return;
    }
    if (!trimmedAddress || busy) return;
    const existingAddress = stops.find((stop) => normalizeDeliveryAddress(stop.address) === normalizeDeliveryAddress(trimmedAddress));
    setBusy(true);
    setStorageError('');
    try {
      if (existingAddress) {
        const next = stops.map((stop) => stop.id === existingAddress.id ? { ...stop, recordCount: Math.max(1, stop.recordCount ?? 0) + 1 } : stop);
        if (isFirebaseConfigured && user) await incrementDeliveryRecordCount(user.uid, existingAddress.id);
        else if (isFirebaseConfigured) {
          setStorageError('Inicia sesión en Cuenta para guardar tus paradas en la nube.');
          return;
        } else await persistLocal(next);
        setStops(next);
        setStorageError('La dirección ya estaba en tu ruta: agrupé este pedido en la misma parada.');
      } else if (isFirebaseConfigured && user) {
        const created = await addDeliveryToTodayRoute(user.uid, trimmedAddress, { recordCount: 1 });
        setStops((current) => [...current, created].sort((left, right) => left.sequence - right.sequence));
        if (!activeStopId && created.status === 'pending') setActiveStopId(created.id);
      } else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión en Cuenta para guardar tus paradas en la nube.');
        return;
      } else {
        const sequence = Math.max(0, ...stops.map((stop) => stop.sequence)) + 1;
        const created: Delivery = { id: `${Date.now()}`, address: trimmedAddress, sequence, displayNumber: String(sequence), status: 'pending', failureReason: null, proofPhotoUrl: null, customerCount: 0, recordCount: 1, note: '' };
        const next = [...stops, created].sort((left, right) => left.sequence - right.sequence);
        await persistLocal(next);
        setStops(next);
        if (!activeStopId) setActiveStopId(created.id);
      }
      setAddress('');
    } catch {
      setStorageError('No se pudo guardar la parada. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseCsvFile() {
    if (routeFinished) {
      setStorageError('Esta jornada ya terminó. Podrás iniciar una nueva ruta mañana.');
      return;
    }
    if (busy || isLoading || isReadingFile) return;
    setStorageError('');
    setImportPreview(null);
    setIsReadingFile(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const extension = file.name.toLowerCase().split('.').pop();
      if (!['csv', 'xlsx', 'xls'].includes(extension ?? '')) {
        setStorageError('Elige un archivo Excel (.xlsx o .xls) o CSV.');
        return;
      }
      const fileResponse = await fetch(file.uri);
      let addresses: ImportedAddress[];
      if (extension === 'csv') {
        addresses = parseCsvAddresses(await fileResponse.text());
      } else {
        const workbookBytes = new Uint8Array(await fileResponse.arrayBuffer());
        const workbook = XLSX.read(workbookBytes, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
        const rows = worksheet
          ? XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '' })
          : [];
        addresses = parseAddressRows(rows.map((row) => row.map((cell) => String(cell ?? ''))));
      }
      if (addresses.length === 0) {
        setStorageError('No encontramos direcciones. Usa una columna llamada Dirección o deja las direcciones en la primera columna de la primera hoja.');
        return;
      }
      const existing = new Set(stops.map((stop) => normalizeDeliveryAddress(stop.address)));
      const newAddresses = addresses.filter((item) => !existing.has(normalizeDeliveryAddress(item.address)));
      if (newAddresses.length === 0) {
        setStorageError('Todas las direcciones del archivo ya están en la ruta.');
        return;
      }
      setImportPreview(newAddresses);
    } catch (error) {
      console.warn('No se pudo importar el archivo seleccionado:', error);
      const detail = error instanceof Error ? error.message : 'Error de lectura';
      setStorageError(`No se pudo abrir el archivo. ${detail}. Revisa que sea un Excel o CSV válido.`);
    } finally {
      setIsReadingFile(false);
    }
  }

  async function importCsvAddresses() {
    if (routeFinished) return;
    if (!importPreview?.length || busy) return;
    if (isFirebaseConfigured && !user) {
      setStorageError('Inicia sesión en Cuenta para importar las paradas a Firebase.');
      return;
    }
    setBusy(true);
    setStorageError('');
    try {
      let chooseActiveStop = !activeStopId;
      if (isFirebaseConfigured && user) {
        for (const item of importPreview) {
          const created = await addDeliveryToTodayRoute(user.uid, item.address, item);
          setStops((current) => [...current, created].sort((left, right) => left.sequence - right.sequence));
          if (chooseActiveStop) {
            setActiveStopId(created.id);
            chooseActiveStop = false;
          }
        }
      } else {
        const firstSequence = Math.max(0, ...stops.map((stop) => stop.sequence)) + 1;
        const imported = importPreview.map((item, index): Delivery => ({
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          address: item.address,
          customerCount: item.customerCount,
          recordCount: item.recordCount,
          note: '',
          sequence: firstSequence + index,
          displayNumber: String(firstSequence + index),
          status: 'pending',
          failureReason: null,
          proofPhotoUrl: null,
        }));
        const next = [...stops, ...imported].sort((left, right) => left.sequence - right.sequence);
        await persistLocal(next);
        setStops(next);
        if (chooseActiveStop) setActiveStopId(imported[0]?.id ?? null);
      }
      setImportPreview(null);
    } catch {
      setStorageError('Algunas paradas podrían haberse importado antes del error. Revisa la ruta e inténtalo con las restantes.');
    } finally {
      setBusy(false);
    }
  }

  async function removeStop(stopId: string) {
    if (busy || routeFinished) return;
    setBusy(true);
    setStorageError('');
    try {
      const next = stops.filter((stop) => stop.id !== stopId);
      if (isFirebaseConfigured && user) await removeDeliveryFromTodayRoute(user.uid, stopId);
      else await persistLocal(next);
      setStops(next);
      if (activeStopId === stopId) setActiveStopId(next.find((stop) => stop.status === 'pending')?.id ?? null);
    } catch {
      setStorageError('No se pudo eliminar la parada. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoveStop(stop: Delivery) {
    Alert.alert('Eliminar parada', `¿Quieres eliminar esta parada?\n\n${stop.address}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, eliminar', style: 'destructive', onPress: () => void removeStop(stop.id) },
    ]);
  }

  async function markDelivered(stop: Delivery) {
    if (busy || routeFinished) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'delivered' as const, failureReason: null } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'delivered');
      else await persistLocal(next);
      setStops(next);
      if (routeStarted && activeStopId === stop.id) {
        const following = next.find((item) => item.sequence > stop.sequence && item.status === 'pending')
          ?? next.find((item) => item.status === 'pending')
          ?? null;
        setActiveStopId(following?.id ?? null);
        if (following) {
          showNextStopNotice(`Siguiente: parada ${following.displayNumber ?? following.sequence} de ${stops.length}`);
          if (navigationProvider !== 'inside') await openNavigation(following);
        } else showNextStopNotice('No quedan paradas pendientes');
      }
    } catch {
      setStorageError('No se pudo actualizar la entrega. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function markFailed(stop: Delivery, reasonOverride?: string) {
    const reason = reasonOverride?.trim() || failureReason.trim();
    if (!reason || busy || routeFinished) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'failed' as const, failureReason: reason } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'failed', reason);
      else await persistLocal(next);
      setStops(next);
      setFailureId(null);
      setFailureReason('');
      if (routeStarted && activeStopId === stop.id) {
        const following = next.find((item) => item.sequence > stop.sequence && item.status === 'pending')
          ?? next.find((item) => item.status === 'pending')
          ?? null;
        setActiveStopId(following?.id ?? null);
        if (following) {
          showNextStopNotice(`Siguiente: parada ${following.displayNumber ?? following.sequence} de ${stops.length}`);
          if (navigationProvider !== 'inside') await openNavigation(following);
        } else {
          showNextStopNotice('No quedan paradas pendientes');
          await clearNextStopNotification();
        }
      }
    } catch {
      setStorageError('No se pudo guardar el motivo. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPending(stop: Delivery) {
    if (busy || routeFinished) return;
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

  async function saveStopNote(stopId: string) {
    if (savingNoteId || routeFinished) return;
    const stop = stops.find((item) => item.id === stopId);
    if (!stop) return;
    setSavingNoteId(stopId);
    setSavedNoteId(null);
    setStorageError('');
    try {
      const note = (stop.note ?? '').trim().slice(0, 300);
      const next = stops.map((item) => item.id === stopId ? { ...item, note } : item);
      if (isFirebaseConfigured && user) await updateDeliveryNote(user.uid, stopId, note);
      else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión en Cuenta para guardar la nota de esta parada.');
        return;
      } else await persistLocal(next);
      setStops(next);
      setSavedNoteId(stopId);
    } catch {
      setStorageError('No se pudo guardar la nota. Inténtalo de nuevo.');
    } finally {
      setSavingNoteId(null);
    }
  }

  async function openNavigation(stop: Delivery) {
    if (navigationProvider === 'inside') return;
    const encodedAddress = encodeURIComponent(`${stop.address}, Santiago, Chile`);
    const url = navigationProvider === 'waze'
      ? `https://waze.com/ul?q=${encodedAddress}&navigate=yes`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch {
      setStorageError('No se pudo abrir la aplicación de navegación.');
    }
  }

  async function navigateToStop(stop: Delivery) {
    setActiveStopId(stop.id);
    if (navigationProvider === 'inside') {
      routeScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    await openNavigation(stop);
  }

  async function beginRoute(firstPending: Delivery) {
    try {
      const startedAt = Date.now();
      const persistedStartedAt = isFirebaseConfigured && user
        ? await markTodayRouteStarted(user.uid)
        : await saveLocalRouteStartedAt(startedAt);
      setRouteStartedAt(persistedStartedAt);
      setRouteFinished(false);
      setActiveStopId(firstPending.id);
      setRouteStarted(true);
      setStopListExpanded(false);
      showNextStopNotice(`Ruta iniciada · parada ${firstPending.displayNumber ?? firstPending.sequence} de ${stops.length}`);
      if (navigationProvider !== 'inside') await openNavigation(firstPending);
    } catch {
      setStorageError('No se pudo iniciar la ruta. Revisa tu conexión e inténtalo otra vez.');
    }
  }

  async function finishRouteNow() {
    if (busy || routeFinished) return;
    setBusy(true);
    try {
      const completedAt = Date.now();
      const startedAt = routeStartedAt ?? completedAt;
      if (isFirebaseConfigured && user) await completeTodayRoute(user.uid);
      else if (isFirebaseConfigured) throw new Error('login-required');
      else await finishLocalRoute(completedAt);

      const summary = {
        elapsedMs: Math.max(0, completedAt - startedAt),
        delivered: stops.filter((stop) => stop.status === 'delivered').length,
        failed: stops.filter((stop) => stop.status === 'failed').length,
        pending: stops.filter((stop) => stop.status === 'pending').length,
      };
      setRouteSummary(summary);
      setRouteStarted(false);
      setRouteFinished(true);
      setStopListExpanded(false);
      setVisitedStopsExpanded(false);
      setActiveStopId(null);
      await clearNextStopNotification();
      setSummaryVisible(true);
      summaryScale.setValue(0.72);
      summaryOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(summaryScale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 150 }),
        Animated.timing(summaryOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } catch {
      setStorageError('No se pudo terminar la ruta. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  function confirmFinishRoute() {
    if (!routeStarted || routeFinished) return;
    const pending = stops.filter((stop) => stop.status === 'pending').length;
    Alert.alert(
      'Terminar ruta',
      pending > 0 ? `Quedan ${pending} paradas pendientes. ¿Quieres terminar la ruta y guardarlas como pendientes?` : '¿Quieres terminar y guardar el resumen de esta ruta?',
      [
        { text: 'Seguir en ruta', style: 'cancel' },
        { text: 'Terminar ruta', style: 'destructive', onPress: () => void finishRouteNow() },
      ],
    );
  }

  async function startRoute() {
    if (routeFinished) return;
    const firstPending = stops.find((stop) => stop.status === 'pending');
    if (!firstPending) {
      setStorageError('Agrega una parada pendiente antes de iniciar la ruta.');
      return;
    }
    const notificationsAllowed = await prepareRouteNotifications().catch(() => false);
    if (!notificationsAllowed) {
      Alert.alert('Activa las notificaciones', 'Connect necesita permiso para mostrar la siguiente parada y sus botones cuando minimices la app. Puedes iniciar la ruta sin ese panel.', [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Iniciar sin panel', onPress: () => { void beginRoute(firstPending); } },
        { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    await beginRoute(firstPending);
  }

  function confirmApproximateOrder(ids: string[]) {
    Alert.alert(
      'Orden aproximado',
      'Connect ordenará las paradas por cercanía en línea recta y volverá a numerarlas. Confirma este orden antes de escribir los números en tus paquetes.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ordenar paradas', onPress: () => { void applyApproximateOrder(ids); } },
      ],
    );
  }

  async function optimizeCurrentRoute() {
    if (isOptimizing || routeStarted || routeFinished || stops.length < 2) return;
    setIsOptimizing(true);
    setStorageError('');
    try {
      if (Platform.OS === 'android') {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setStorageError('Permite la ubicación mientras usas Connect para ordenar las paradas.');
          return;
        }
      }

      const coordinates = new Map<string, { latitude: number; longitude: number }>();
      const orderedByCurrentSequence = [...stops].sort((left, right) => left.sequence - right.sequence);
      for (const [index, stop] of orderedByCurrentSequence.entries()) {
        try {
          const result = (await Location.geocodeAsync(`${stop.address}, Santiago, Chile`))[0];
          if (result) coordinates.set(stop.id, { latitude: result.latitude, longitude: result.longitude });
        } catch {
          // Show the addresses that could not be located below instead of silently dropping them.
        }
        if (index < orderedByCurrentSequence.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const missing = orderedByCurrentSequence.filter((stop) => !coordinates.has(stop.id));
      if (missing.length > 0) {
        setStorageError(`No pude ubicar ${missing.length} parada(s). Revisa que cada dirección tenga número y comuna.`);
        return;
      }

      const remaining = [...orderedByCurrentSequence];
      const ordered = [remaining.shift()!];
      while (remaining.length) {
        const current = coordinates.get(ordered[ordered.length - 1].id)!;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        remaining.forEach((candidate, index) => {
          const point = coordinates.get(candidate.id)!;
          const distance = Math.hypot(point.latitude - current.latitude, point.longitude - current.longitude);
          if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
        });
        ordered.push(remaining.splice(nearestIndex, 1)[0]);
      }
      confirmApproximateOrder(ordered.map((stop) => stop.id));
    } catch {
      setStorageError('No se pudieron ubicar las direcciones. Revisa la conexión e inténtalo otra vez.');
    } finally {
      setIsOptimizing(false);
    }
  }

  async function applyApproximateOrder(ids: string[]) {
    if (routeStarted) return;
    const byId = new Map(stops.map((stop) => [stop.id, stop]));
    const ordered = ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    const next = ordered.map((stop, index) => ({ ...stop, sequence: index + 1, displayNumber: String(index + 1) }));
    try {
      if (isFirebaseConfigured && user) await updateDeliveryOrder(user.uid, next.map(({ id, sequence, displayNumber: number }) => ({ id, sequence, displayNumber: number })));
      else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión para guardar el orden optimizado.');
        return;
      } else await persistLocal(next);
      setStops(next);
      setActiveStopId(next.find((stop) => stop.status === 'pending')?.id ?? null);
      setStorageError('');
    } catch {
      setStorageError('No se pudo guardar el nuevo orden. Inténtalo de nuevo.');
    }
  }

  return (
    <>
    <SafeAreaView style={styles.safeArea}>
      {routeStarted && navigationProvider === 'inside' ? (
        <View style={styles.liveRouteScreen}>
          <View style={styles.liveRouteHeader}>
            <Pressable style={styles.liveListButton} onPress={() => setStopListExpanded(true)}><Text style={styles.liveListButtonText}>☰  Paradas</Text></Pressable>
            <Text style={styles.liveRouteTitle}>Ruta en curso</Text>
            <Text style={styles.liveProgress}>{activeStop ? (activeStop.displayNumber ?? activeStop.sequence) : stops.length} de {stops.length}</Text>
          </View>
          <RouteMap expanded stops={stops} activeStopId={activeStop?.id} routeStarted onSelectStop={(id) => { if (stops.some((stop) => stop.id === id && stop.status === 'pending')) setActiveStopId(id); }} />
          <View style={styles.liveStopCard}>
            {Boolean(nextStopNotice) && <Animated.View style={[styles.nextStopNotice, { opacity: nextStopNoticeOpacity, transform: [{ translateY: nextStopNoticeOffset }] }]}><Text style={styles.nextStopNoticeText}>✓  {nextStopNotice}</Text></Animated.View>}
            <Text style={styles.liveStopEyebrow}>{activeStop ? `PARADA ${activeStop.displayNumber ?? activeStop.sequence} DE ${stops.length}` : 'RUTA'}</Text>
            <Text style={styles.liveStopAddress}>{activeStop?.address ?? 'No quedan paradas pendientes'}</Text>
            {!!activeStop?.note?.trim() && <Text style={styles.liveStopNote}>Paquetes: {activeStop.note}</Text>}
            {activeStop ? <View style={styles.liveActionRow}>
              <Pressable style={[styles.deliveredButton, styles.liveActionButton]} onPress={() => void markDelivered(activeStop)} disabled={busy}><Text style={styles.deliveredButtonText}>✓  Entregada</Text></Pressable>
              <Pressable style={[styles.failedButton, styles.liveActionButton]} onPress={() => { setFailureId(failureId === activeStop.id ? null : activeStop.id); setFailureReason(''); }} disabled={busy}><Text style={styles.failedButtonText}>Fallida</Text></Pressable>
            </View> : <Text style={styles.finishedHint}>Puedes cerrar la ruta y guardar el resumen.</Text>}
            {activeStop && failureId === activeStop.id && <View style={styles.liveFailureRow}><TextInput value={failureReason} onChangeText={setFailureReason} placeholder="Motivo de la entrega fallida" placeholderTextColor="#91A098" style={[styles.reasonInput, styles.liveReasonInput]} maxLength={300} /><Pressable style={[styles.failedButton, styles.liveSaveFailure]} onPress={() => void markFailed(activeStop)} disabled={busy}><Text style={styles.failedButtonText}>Guardar</Text></Pressable></View>}
            <View style={styles.liveFooterRow}>
              <Text style={styles.liveRemaining}>{pendingStops.length} pendientes</Text>
              <Pressable style={styles.liveFinishButton} onPress={confirmFinishRoute} disabled={busy}><Text style={styles.liveFinishText}>Terminar ruta</Text></Pressable>
            </View>
          </View>
        </View>
      ) : (
      <ScrollView ref={routeScrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href="/" asChild><Pressable style={styles.backButton}><Text style={styles.backText}>‹  Inicio</Text></Pressable></Link>
        <Text style={styles.eyebrow}>PLANIFICACIÓN</Text>
        <Text style={styles.title}>{stops.length === 0 ? 'Nuevo día' : 'Tu ruta'}</Text>
        <Text style={styles.subtitle}>Agrega direcciones y registra el resultado de cada entrega.</Text>

        <RouteMap stops={stops} activeStopId={activeStopId} routeStarted={routeStarted} onSelectStop={(id) => { if (stops.some((stop) => stop.id === id && stop.status === 'pending')) setActiveStopId(id); }} />

        {!!storageError && <Animated.View accessibilityRole="alert" style={[styles.toast, { opacity: toastOpacity, transform: [{ translateY: toastOffset }] }]}>
          <View style={[styles.toastAccent, storageError.startsWith('La dirección ya estaba') && styles.toastSuccessAccent]} />
          <Text style={[styles.toastMessage, storageError.startsWith('La dirección ya estaba') && styles.toastSuccessMessage]}>{storageError}</Text>
          <Pressable onPress={() => setStorageError('')} hitSlop={10} accessibilityLabel="Cerrar aviso" style={styles.toastClose}>
            <Text style={styles.toastCloseText}>×</Text>
          </Pressable>
        </Animated.View>}

        {!routeFinished && <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>DIRECCIÓN DE LA PARADA</Text>
          <TextInput value={address} onChangeText={setAddress} placeholder="Ej.: Av. Los Olivos 123, Santiago" placeholderTextColor="#91A098" style={styles.input} returnKeyType="done" onSubmitEditing={addStop} />
          <Pressable style={[styles.addButton, (isLoading || busy) && styles.disabledButton]} onPress={addStop} disabled={isLoading || busy}>
            <Text style={styles.addButtonText}>{busy ? 'Guardando…' : '＋  Añadir parada'}</Text>
          </Pressable>
          <Pressable style={[styles.importButton, (isLoading || busy || isReadingFile) && styles.disabledButton]} onPress={chooseCsvFile} disabled={isLoading || busy || isReadingFile}>
          <Text style={styles.importButtonText}>{isReadingFile ? 'Abriendo archivo…' : 'Importar Excel o CSV'}</Text>
          </Pressable>
          <Text style={styles.csvHint}>Admite .xlsx, .xls y .csv; importa la primera hoja.</Text>
        </View>}

        {!routeFinished && importPreview && <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Revisar importación</Text>
          <Text style={styles.previewText}>{importPreview.length} {importPreview.length === 1 ? 'domicilio nuevo' : 'domicilios nuevos'} agrupados. Los clientes se cuentan por nombre; la nota de paquetes la agrega el repartidor.</Text>
          {importPreview.slice(0, 3).map((item, index) => <Text key={`${index}-${item.address}`} style={styles.previewAddress}>• {item.address} · {item.customerCount > 0 ? `${item.customerCount} ${item.customerCount === 1 ? 'cliente' : 'clientes'}` : `${item.recordCount} ${item.recordCount === 1 ? 'pedido agrupado' : 'pedidos agrupados'}`}</Text>)}
          {importPreview.length > 3 && <Text style={styles.previewText}>y {importPreview.length - 3} más…</Text>}
          <View style={styles.previewActions}>
            <Pressable style={styles.cancelImportButton} onPress={() => setImportPreview(null)} disabled={busy}><Text style={styles.cancelImportText}>Cancelar</Text></Pressable>
            <Pressable style={[styles.confirmImportButton, busy && styles.disabledButton]} onPress={importCsvAddresses} disabled={busy}><Text style={styles.confirmImportText}>{busy ? 'Importando…' : 'Añadir paradas'}</Text></Pressable>
          </View>
        </View>}

        {isFirebaseConfigured && !user && <View style={styles.accountNotice}><Text style={styles.accountText}>Inicia sesión para guardar y consultar tus rutas en Firebase.</Text><Link href="/cuenta" asChild><Pressable><Text style={styles.accountLink}>Ir a Cuenta →</Text></Pressable></Link></View>}
        {stops.length > 0 && <View style={styles.navigationCard}>
          <Text style={styles.navigationTitle}>{routeFinished ? 'Ruta terminada' : routeStarted ? 'Ruta iniciada' : '¿Listo para salir?'}</Text>
          {!routeFinished && <Text style={styles.navigationHint}>Al entregar la parada activa, Connect avanzará a la siguiente.</Text>}
          {!routeFinished && <View style={styles.providerRow}>
            {([['inside', 'Mapa integrado'], ['google', 'Google Maps'], ['waze', 'Waze']] as const).map(([provider, label]) => <Pressable key={provider} onPress={() => { setNavigationProvider(provider); void setMap(provider); }} style={[styles.providerButton, navigationProvider === provider && styles.providerSelected]}><Text style={[styles.providerText, navigationProvider === provider && styles.providerTextSelected]}>{label}</Text></Pressable>)}
          </View>}
          {!routeFinished && <Pressable style={styles.startButton} onPress={() => void startRoute()}><Text style={styles.startButtonText}>{routeStarted ? 'Reanudar navegación' : 'Iniciar ruta'}</Text></Pressable>}
          {routeFinished && <Text style={styles.finishedHint}>El resumen de esta jornada quedó guardado en Historial.</Text>}
        </View>}
        <View style={styles.listHeader}>
          <Text style={styles.listHeading}>{routeFinished ? 'Ruta cerrada' : 'Paradas de hoy'} <Text style={styles.stopCount}>{stops.length}</Text></Text>
          <Link href="/historial" asChild><Pressable hitSlop={8}><Text style={styles.historyLink}>Historial →</Text></Pressable></Link>
        </View>
        {routeFinished && <Text style={styles.finishedHint}>Esta ruta está cerrada. Las paradas pendientes quedan guardadas en el resumen y ya no se pueden marcar ni editar desde aquí.</Text>}
        {routeFinished && visitedStops.length > 0 && <Pressable style={styles.visitedToggle} onPress={() => setVisitedStopsExpanded((expanded) => !expanded)}><Text style={styles.visitedToggleText}>{visitedStopsExpanded ? '⌄ Ocultar' : '› Ver'} {visitedStops.filter((stop) => stop.status === 'delivered').length} entregadas · {visitedStops.filter((stop) => stop.status === 'failed').length} fallidas</Text></Pressable>}
        {stops.length > 1 && !routeStarted && !routeFinished && <Pressable style={[styles.optimizeRouteButton, isOptimizing && styles.disabledButton]} onPress={() => void optimizeCurrentRoute()} disabled={isOptimizing}>
          <Text style={styles.optimizeRouteText}>{isOptimizing ? 'Calculando orden…' : 'Optimizar orden de paradas'}</Text>
        </Pressable>}
        {stops.length > 0 && <Text style={styles.routeEstimate}>Estimación de paradas: {Math.floor(stops.length / 60) > 0 ? `${Math.floor(stops.length / 60)} h ` : ''}{stops.length % 60} min · 1 minuto por parada, sin contar traslados.</Text>}
        {isLoading ? <Text style={styles.helper}>Cargando ruta…</Text> : stops.length === 0 ? (
          <View style={styles.emptyCard}><View style={styles.pin}><Text style={styles.pinText}>⌖</Text></View><Text style={styles.emptyTitle}>Tu lista está vacía</Text><Text style={styles.emptyDescription}>Escribe una dirección arriba para empezar.</Text></View>
        ) : visibleStops.map((stop, index) => (
          <View key={stop.id} style={styles.stopCard}>
            <View style={styles.stopTop}>
              <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{stop.displayNumber ?? String(stop.sequence || index + 1)}</Text></View>
              <View style={styles.addressCopy}><Text style={styles.stopAddress}>{stop.address}</Text><Text style={styles.customerCount}>{stop.customerCount > 0 ? `${stop.customerCount} ${stop.customerCount === 1 ? 'cliente' : 'clientes'}` : stop.recordCount > 0 ? `${stop.recordCount} ${stop.recordCount === 1 ? 'pedido agrupado' : 'pedidos agrupados'}` : 'Cliente sin identificar'}</Text></View>
            {!routeFinished && <Pressable onPress={() => confirmRemoveStop(stop)} hitSlop={10} accessibilityLabel={`Eliminar parada ${stop.displayNumber ?? index + 1}`}><Text style={styles.removeStop}>×</Text></Pressable>}
            </View>
            <Text style={[styles.status, stop.status === 'delivered' && styles.delivered, stop.status === 'failed' && styles.failed]}>
              {stop.status === 'delivered' ? 'Entregada' : stop.status === 'failed' ? `Fallida · ${stop.failureReason ?? ''}` : routeFinished ? 'Pendiente al cerrar la ruta' : 'Pendiente'}
            </Text>
            {!routeFinished && <Pressable style={styles.navigateStopButton} onPress={() => void navigateToStop(stop)} accessibilityLabel={`Navegar a ${stop.address}`}>
              <Text style={styles.navigateStopButtonText}>↗  Navegar a esta parada</Text>
            </Pressable>}
            {!routeFinished && (stop.status === 'pending' ? <View style={styles.actions}>
              <Pressable style={styles.deliveredButton} onPress={() => markDelivered(stop)}><Text style={styles.deliveredButtonText}>Marcar entregada</Text></Pressable>
              <Pressable style={styles.failedButton} onPress={() => { setFailureId(failureId === stop.id ? null : stop.id); setFailureReason(''); }}><Text style={styles.failedButtonText}>Fallida</Text></Pressable>
            </View> : <Pressable onPress={() => resetPending(stop)}><Text style={styles.resetLink}>Deshacer</Text></Pressable>)}
            {!routeFinished && <View style={styles.noteEditor}>
              <Text style={styles.packageTip}>Recuerda anotar cuántos paquetes debes bajar.</Text>
              <TextInput value={stop.note ?? ''} onChangeText={(value) => { setSavedNoteId(null); setStops((current) => current.map((item) => item.id === stop.id ? { ...item, note: value } : item)); }} placeholder="Ej.: debo bajar 10 paquetes" placeholderTextColor="#91A098" style={styles.noteInput} maxLength={300} />
              <Pressable style={styles.noteSaveButton} onPress={() => void saveStopNote(stop.id)} disabled={savingNoteId !== null}><Text style={styles.noteSaveText}>{savingNoteId === stop.id ? 'Guardando…' : savedNoteId === stop.id ? 'Nota guardada ✓' : 'Guardar nota'}</Text></Pressable>
            </View>}
            {!routeFinished && failureId === stop.id && <View style={styles.failureForm}><TextInput value={failureReason} onChangeText={setFailureReason} placeholder="Motivo de la entrega fallida" placeholderTextColor="#91A098" style={styles.reasonInput} maxLength={300} /><Pressable style={styles.failedButton} onPress={() => markFailed(stop)}><Text style={styles.failedButtonText}>Guardar motivo</Text></Pressable></View>}
          </View>
        ))}
        {routeStarted && stops.length > 0 && <View style={styles.finishRouteSection}>
          <Text style={styles.finishRouteHint}>¿Ya completaste tu jornada?</Text>
          <Pressable style={styles.finishRouteButton} onPress={confirmFinishRoute} disabled={busy}><Text style={styles.finishRouteButtonText}>{busy ? 'Guardando…' : 'Terminar ruta'}</Text></Pressable>
        </View>}
        {!isFirebaseConfigured && <View style={styles.note}><Text style={styles.noteTitle}>Guardadas en este teléfono</Text><Text style={styles.noteText}>Cuando configures Firebase, estas paradas locales seguirán disponibles aquí y las nuevas se guardarán en tu cuenta.</Text></View>}
      </ScrollView>
      )}
    </SafeAreaView>
    <Modal visible={stopListExpanded && routeStarted && navigationProvider === 'inside'} transparent animationType="slide" onRequestClose={() => setStopListExpanded(false)}>
      <View style={styles.stopListOverlay}>
        <View style={styles.stopListSheet}>
          <View style={styles.stopListHeader}><View><Text style={styles.stopListTitle}>Paradas de la ruta</Text><Text style={styles.stopListSubtitle}>{pendingStops.length} pendientes · {visitedStops.length} visitadas</Text></View><Pressable onPress={() => setStopListExpanded(false)} style={styles.stopListClose}><Text style={styles.stopListCloseText}>×</Text></Pressable></View>
          <ScrollView contentContainerStyle={styles.stopListContent}>
            <Text style={styles.stopGroupHeading}>PENDIENTES · {pendingStops.length}</Text>
            {pendingStops.map((stop) => <Pressable key={stop.id} style={[styles.stopListRow, stop.id === activeStop?.id && styles.stopListRowActive]} onPress={() => { setActiveStopId(stop.id); setStopListExpanded(false); }}><Text style={styles.stopListNumber}>{stop.displayNumber ?? stop.sequence}</Text><View style={styles.stopListCopy}><Text style={styles.stopListAddress} numberOfLines={2}>{stop.address}</Text>{!!stop.note?.trim() && <Text style={styles.stopListNote} numberOfLines={1}>Paquetes: {stop.note}</Text>}</View><Text style={styles.stopListStatusPending}>Pendiente</Text></Pressable>)}
            {visitedStops.length > 0 && <><Pressable style={styles.stopGroupToggle} onPress={() => setVisitedStopsExpanded((expanded) => !expanded)}><Text style={styles.stopGroupHeading}>{visitedStopsExpanded ? '⌄' : '›'} VISITADAS · {visitedStops.length}</Text></Pressable>{visitedStopsExpanded && visitedStops.map((stop) => <View key={stop.id} style={styles.stopListRow}><Text style={styles.stopListNumber}>{stop.displayNumber ?? stop.sequence}</Text><View style={styles.stopListCopy}><Text style={styles.stopListAddress} numberOfLines={2}>{stop.address}</Text></View><Text style={stop.status === 'delivered' ? styles.stopListStatusDone : styles.stopListStatusFailed}>{stop.status === 'delivered' ? 'Entregada' : 'Fallida'}</Text></View>)}</>}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={summaryVisible && routeSummary !== null} transparent animationType="fade" onRequestClose={() => setSummaryVisible(false)}>
      <View style={styles.summaryOverlay}>
        <Animated.View style={[styles.summaryCard, { opacity: summaryOpacity, transform: [{ scale: summaryScale }] }]}>
          <View style={styles.summaryCheckCircle}><Text style={styles.summaryCheck}>✓✓</Text></View>
          <Text style={styles.summaryTitle}>¡Ruta terminada!</Text>
          <Text style={styles.summarySubtitle}>Buen trabajo. Este es el resumen de tu jornada.</Text>
          <View style={styles.summaryDuration}><Text style={styles.summaryDurationLabel}>TIEMPO EN RUTA</Text><Text style={styles.summaryDurationValue}>{formatElapsed(routeSummary?.elapsedMs ?? 0)}</Text></View>
          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}><Text style={styles.summaryDeliveredNumber}>{routeSummary?.delivered ?? 0}</Text><Text style={styles.summaryStatLabel}>Entregadas</Text></View>
            <View style={styles.summaryStatDivider} />
            <View style={styles.summaryStat}><Text style={styles.summaryFailedNumber}>{routeSummary?.failed ?? 0}</Text><Text style={styles.summaryStatLabel}>Fallidas</Text></View>
            <View style={styles.summaryStatDivider} />
            <View style={styles.summaryStat}><Text style={styles.summaryPendingNumber}>{routeSummary?.pending ?? 0}</Text><Text style={styles.summaryStatLabel}>Pendientes</Text></View>
          </View>
          <Pressable style={styles.summaryCloseButton} onPress={() => setSummaryVisible(false)}><Text style={styles.summaryCloseText}>Listo</Text></Pressable>
        </Animated.View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale }, content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116, flexGrow: 1 },
  liveRouteScreen: { flex: 1, width: '100%', alignSelf: 'center', backgroundColor: colors.pale }, liveRouteHeader: { minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line }, liveListButton: { minWidth: 82, minHeight: 38, justifyContent: 'center' }, liveListButtonText: { color: colors.green, fontSize: 12, fontWeight: '700' }, liveRouteTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, liveProgress: { minWidth: 62, textAlign: 'right', color: colors.green, fontSize: 14, fontWeight: '800' },
  liveStopCard: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.line }, liveStopEyebrow: { color: colors.green, fontSize: 9, letterSpacing: 1.1, fontWeight: '800' }, liveStopAddress: { color: colors.ink, fontSize: 14, fontWeight: '700', lineHeight: 19, marginTop: 4 }, liveStopNote: { color: colors.muted, fontSize: 11, marginTop: 4 }, liveActionRow: { flexDirection: 'row', gap: 9, marginTop: 10 }, liveActionButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' }, liveFailureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, liveReasonInput: { flex: 1, marginBottom: 0 }, liveSaveFailure: { minHeight: 40, justifyContent: 'center' }, liveFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }, liveRemaining: { color: colors.muted, fontSize: 10 }, liveFinishButton: { paddingVertical: 6, paddingHorizontal: 10 }, liveFinishText: { color: colors.red, fontSize: 10, fontWeight: '700' }, nextStopNotice: { position: 'absolute', zIndex: 5, alignSelf: 'center', top: -43, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: colors.green, shadowColor: '#14271B', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 }, nextStopNoticeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  stopListOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13, 28, 19, 0.35)' }, stopListSheet: { maxHeight: '82%', minHeight: '48%', backgroundColor: colors.pale, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingHorizontal: 16 }, stopListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line }, stopListTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' }, stopListSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 }, stopListClose: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white }, stopListCloseText: { color: colors.ink, fontSize: 24 }, stopListContent: { paddingBottom: 24 }, stopGroupHeading: { color: colors.muted, fontSize: 9, letterSpacing: 1, fontWeight: '800', paddingTop: 14, paddingBottom: 7 }, stopGroupToggle: { marginTop: 5, borderTopWidth: 1, borderTopColor: colors.line }, stopListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 9, marginBottom: 5, backgroundColor: colors.white, borderRadius: 12 }, stopListRowActive: { borderWidth: 1, borderColor: colors.green, backgroundColor: '#F1F6EF' }, stopListNumber: { width: 30, color: colors.green, fontSize: 12, fontWeight: '800' }, stopListCopy: { flex: 1, paddingRight: 7 }, stopListAddress: { color: colors.ink, fontSize: 11, fontWeight: '600', lineHeight: 15 }, stopListNote: { color: colors.muted, fontSize: 9, marginTop: 2 }, stopListStatusPending: { color: '#94602B', fontSize: 9, fontWeight: '700' }, stopListStatusDone: { color: colors.green, fontSize: 9, fontWeight: '700' }, stopListStatusFailed: { color: colors.red, fontSize: 9, fontWeight: '700' }, visitedToggle: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 9, borderRadius: 11, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, visitedToggleText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 }, backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }, title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  inputCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, marginTop: 24 }, inputLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }, input: { minHeight: 48, color: colors.ink, fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 14 },
  addButton: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 14, marginTop: 16 }, disabledButton: { opacity: 0.55 }, addButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  importButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, marginTop: 9 }, importButtonText: { color: colors.green, fontSize: 12, fontWeight: '700' }, csvHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 7, textAlign: 'center' },
  previewCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 15, marginTop: 12 }, previewTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, previewText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 }, previewAddress: { color: colors.ink, fontSize: 11, lineHeight: 17, marginTop: 5 }, previewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 }, cancelImportButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 }, cancelImportText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, confirmImportButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.green, borderRadius: 11 }, confirmImportText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  accountNotice: { backgroundColor: '#E7EDE3', borderRadius: 14, padding: 14, marginTop: 16 }, accountText: { color: colors.ink, fontSize: 12, lineHeight: 18 }, accountLink: { color: colors.green, fontWeight: '700', marginTop: 8 },
  navigationCard: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 14 }, navigationTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, navigationHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, providerRow: { flexDirection: 'row', gap: 6, marginTop: 10 }, providerButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.line }, providerSelected: { backgroundColor: '#EAF1E8', borderColor: '#B9CBB7' }, providerText: { color: colors.muted, fontSize: 9, fontWeight: '600', textAlign: 'center' }, providerTextSelected: { color: colors.green, fontWeight: '700' }, startButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 11, marginTop: 10 }, startButtonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  finishRouteSection: { alignItems: 'center', marginTop: 15, marginBottom: 16, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, finishRouteHint: { color: colors.muted, fontSize: 11, marginBottom: 9 }, finishRouteButton: { width: '100%', minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#D8A69E', backgroundColor: '#FFF9F7' }, finishRouteButtonText: { color: colors.red, fontSize: 12, fontWeight: '700' }, finishedHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 9, textAlign: 'center' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 25, marginBottom: 10 }, listHeading: { color: colors.ink, fontSize: 15, fontWeight: '700' }, stopCount: { color: colors.green, fontWeight: '700' }, historyLink: { color: colors.green, fontSize: 12, fontWeight: '700' }, helper: { color: colors.muted, padding: 12 }, routeEstimate: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -4, marginBottom: 10 }, optimizeRouteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.green, marginBottom: 10 }, optimizeRouteText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  emptyCard: { minHeight: 185, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 3, backgroundColor: colors.white, borderRadius: 22, borderWidth: 1, borderColor: colors.line }, pin: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center', marginBottom: 17 }, pinText: { color: colors.green, fontSize: 30 }, emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' }, emptyDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  stopCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 8 }, stopTop: { flexDirection: 'row', alignItems: 'center' }, stopNumber: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }, stopNumberText: { color: colors.green, fontSize: 12, fontWeight: '700' }, addressCopy: { flex: 1, marginLeft: 11 }, stopAddress: { color: colors.ink, fontSize: 13 }, customerCount: { color: colors.green, fontSize: 10, fontWeight: '700', marginTop: 4 }, removeStop: { color: colors.muted, fontSize: 23, paddingHorizontal: 5 },
  navigateStopButton: { alignSelf: 'flex-start', marginLeft: 41, marginTop: 9, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#EAF1E8' }, navigateStopButtonText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  noteEditor: { marginLeft: 41, marginTop: 12, padding: 11, backgroundColor: '#F7F9F5', borderRadius: 11 }, packageTip: { color: colors.muted, fontSize: 10, lineHeight: 15 }, noteInput: { minHeight: 40, color: colors.ink, fontSize: 12, borderBottomWidth: 1, borderBottomColor: colors.line, marginTop: 4 }, noteSaveButton: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAF1E8' }, noteSaveText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  status: { color: colors.muted, fontSize: 11, fontWeight: '600', marginLeft: 41, marginTop: 7 }, delivered: { color: colors.green }, failed: { color: colors.red }, actions: { flexDirection: 'row', gap: 8, marginLeft: 41, marginTop: 10 }, deliveredButton: { backgroundColor: '#EAF1E8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }, deliveredButtonText: { color: colors.green, fontSize: 11, fontWeight: '700' }, failedButton: { backgroundColor: '#F8EFE3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }, failedButtonText: { color: '#94602B', fontSize: 11, fontWeight: '700' }, resetLink: { color: colors.green, fontSize: 11, fontWeight: '700', marginLeft: 41, marginTop: 10 }, failureForm: { marginLeft: 41, marginTop: 8 }, reasonInput: { minHeight: 42, borderBottomWidth: 1, borderBottomColor: colors.line, color: colors.ink, fontSize: 12, marginBottom: 8 },
  note: { backgroundColor: '#E7EDE3', borderRadius: 16, padding: 16, marginTop: 14 }, noteTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' }, noteText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  toast: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF9F7', borderColor: '#E8C8C2', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingLeft: 15, paddingRight: 8, marginTop: 12, marginBottom: -12, shadowColor: '#20352B', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 8, zIndex: 10 },
  toastAccent: { width: 4, alignSelf: 'stretch', borderRadius: 3, backgroundColor: colors.red, marginRight: 11 },
  toastMessage: { flex: 1, color: colors.red, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  toastSuccessAccent: { backgroundColor: colors.green },
  toastSuccessMessage: { color: colors.green },
  toastClose: { width: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  toastCloseText: { color: colors.red, fontSize: 23, lineHeight: 26 },
  summaryOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22, backgroundColor: 'rgba(13, 28, 19, 0.55)' },
  summaryCard: { width: '100%', maxWidth: 390, alignItems: 'center', backgroundColor: colors.white, borderRadius: 26, padding: 24, shadowColor: '#14271B', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 16 },
  summaryCheckCircle: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center', borderRadius: 39, backgroundColor: '#25D366', borderWidth: 6, borderColor: '#DFF8E8' }, summaryCheck: { color: colors.white, fontSize: 23, fontWeight: '800', letterSpacing: -7, marginRight: 7 },
  summaryTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginTop: 17 }, summarySubtitle: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  summaryDuration: { width: '100%', alignItems: 'center', borderRadius: 16, backgroundColor: colors.pale, paddingVertical: 14, marginTop: 19 }, summaryDurationLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }, summaryDurationValue: { color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: 5 },
  summaryStats: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 17 }, summaryStat: { flex: 1, alignItems: 'center' }, summaryStatDivider: { width: 1, height: 34, backgroundColor: colors.line }, summaryDeliveredNumber: { color: colors.green, fontSize: 22, fontWeight: '800' }, summaryFailedNumber: { color: '#A14337', fontSize: 22, fontWeight: '800' }, summaryPendingNumber: { color: '#94602B', fontSize: 22, fontWeight: '800' }, summaryStatLabel: { color: colors.muted, fontSize: 10, marginTop: 3 },
  summaryCloseButton: { width: '100%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.green, marginTop: 3 }, summaryCloseText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
