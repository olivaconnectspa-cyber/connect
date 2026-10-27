import { Link, router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { canOfferParkingPhoto } from '@/lib/parking-photo';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDeliveryToTodayRoute, completeTodayRoute, createSharedRouteLink, createTodayRoute, incrementDeliveryRecordCount, loadTodayRoute, markTodayRouteStarted, removeDeliveryFromTodayRoute, updateDeliveryNote, updateDeliveryOrder, updateDeliveryStatus, updateRouteEndpoints, type Delivery } from '@/lib/route-repository';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { createLocalTodayRoute, deleteRouteFavorite, finishLocalRoute, loadLocalRouteEndpoints, loadLocalRouteId, loadLocalRouteName, loadLocalRouteOptimized, loadLocalRouteTiming, loadRouteFavorites, loadStops, saveLocalRouteEndpoints, saveLocalRouteOptimized, saveLocalRouteStartedAt, saveRouteFavorite, saveStops, type RouteFavorite, type Stop } from '@/lib/stops';
import { normalizeDeliveryAddress, parseAddressRows, parseCsvAddresses, type ImportedAddress } from '@/lib/csv';
import { extractPdfAddressRows } from '@/lib/pdf-addresses';
import RouteMap from '@/components/route-map';
import { clearNextStopNotification, prepareRouteNotifications, ROUTE_NOTIFICATION_ACTIONS, showNextStopNotification } from '@/lib/route-notifications';
import { addNotificationResponseReceivedListener } from 'expo-notifications/build/NotificationsEmitter';
import { useAppPreferences } from '@/lib/app-preferences';
import { ThemeLayer } from '@/components/theme-layer';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', red: '#A14337' };
type NavigationProvider = 'google' | 'waze' | 'inside';
type RouteSummary = { elapsedMs: number; delivered: number; failed: number; pending: number };

async function readPickedFileBytes(uri: string) {
  const encodedFile = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const base64 = encodedFile.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new Error('Android devolvió el archivo con una codificación incompleta.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0));
  let outputIndex = 0;
  for (let index = 0; index < base64.length; index += 4) {
    const a = alphabet.indexOf(base64[index]);
    const b = alphabet.indexOf(base64[index + 1]);
    const c = base64[index + 2] === '=' ? 0 : alphabet.indexOf(base64[index + 2]);
    const d = base64[index + 3] === '=' ? 0 : alphabet.indexOf(base64[index + 3]);
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (chunk >> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (chunk >> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = chunk & 0xff;
  }
  return bytes;
}

function describeOperationError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (error instanceof Error) return error.message.slice(0, 120);
  return 'error-desconocido';
}

function repairMojibake(value: string) {
  return value.replace(/(?:Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[\u0080-\u00BF]{2})+/g, (broken) => {
    try {
      const utf8Bytes = Array.from(broken, (character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
      return decodeURIComponent(utf8Bytes);
    } catch {
      return broken;
    }
  });
}

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
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [searchingAddresses, setSearchingAddresses] = useState(false);
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [endAtLastStop, setEndAtLastStop] = useState(true);
  const [routeFavorites, setRouteFavorites] = useState<RouteFavorite[]>([]);
  const [favoriteLabel, setFavoriteLabel] = useState('');
  const [favoriteAddressDraft, setFavoriteAddressDraft] = useState('');
  const [favoriteDialogVisible, setFavoriteDialogVisible] = useState(false);
  const [finalPointDialogVisible, setFinalPointDialogVisible] = useState(false);
  const [addStopPlacementVisible, setAddStopPlacementVisible] = useState(false);
  const [suggestedStopNumber, setSuggestedStopNumber] = useState('');
  const [suggestedStopAddress, setSuggestedStopAddress] = useState('');
  const [placementPreviewAddress, setPlacementPreviewAddress] = useState('');
  const [selectedStopNumber, setSelectedStopNumber] = useState('');
  const [gpsOrigin, setGpsOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [stops, setStops] = useState<Delivery[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [routeStarted, setRouteStarted] = useState(false);
  const [routeStartedAt, setRouteStartedAt] = useState<number | null>(null);
  const [routeFinished, setRouteFinished] = useState(false);
  const [liveNavigationVisible, setLiveNavigationVisible] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeOptimized, setRouteOptimized] = useState(false);
  const [stopListExpanded, setStopListExpanded] = useState(false);
  const [visitedStopsExpanded, setVisitedStopsExpanded] = useState(false);
  const [stopListTab, setStopListTab] = useState<'all' | 'pending' | 'visited'>('pending');
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingPhoneId, setSavingPhoneId] = useState<string | null>(null);
  const [savedPhoneId, setSavedPhoneId] = useState<string | null>(null);
  const [routeName, setRouteName] = useState('Ruta del día');
  const [nextStopNotice, setNextStopNotice] = useState('');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [navigationProvider, setNavigationProvider] = useState<NavigationProvider>('inside');
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [storageError, setStorageError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [photoPromptActive, setPhotoPromptActive] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [failureId, setFailureId] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState('');
  const [failurePromptStep, setFailurePromptStep] = useState<'ask' | 'reason'>('ask');
  const [importPreview, setImportPreview] = useState<ImportedAddress[] | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastOffset = useRef(new Animated.Value(-18)).current;
  const summaryScale = useRef(new Animated.Value(0.75)).current;
  const summaryOpacity = useRef(new Animated.Value(0)).current;
  const nextStopNoticeOpacity = useRef(new Animated.Value(0)).current;
  const nextStopNoticeOffset = useRef(new Animated.Value(10)).current;
  const nextStopNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeScrollRef = useRef<ScrollView>(null);
  const notificationStopIdRef = useRef<string | null>(null);
  const selectedAddressSuggestionRef = useRef(false);
  const autoCreateRouteRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (preferencesReady) setNavigationProvider(savedMap);
  }, [preferencesReady, savedMap]);

  useEffect(() => {
    void loadRouteFavorites().then(setRouteFavorites).catch(() => setRouteFavorites([]));
  }, []);

  useEffect(() => {
    const queryText = address.trim();
    if (selectedAddressSuggestionRef.current) {
      selectedAddressSuggestionRef.current = false;
      setAddressSuggestions([]);
      setSearchingAddresses(false);
      return;
    }
    if (queryText.length < 4 || routeFinished) {
      setAddressSuggestions([]);
      setSearchingAddresses(false);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSearchingAddresses(true);
      try {
        const candidates = await Location.geocodeAsync(`${queryText}, Chile`);
        const labels = await Promise.all(candidates.slice(0, 6).map(async (candidate) => {
          try {
            const [place] = await Location.reverseGeocodeAsync({ latitude: candidate.latitude, longitude: candidate.longitude });
            if (!place) return '';
            return [
              [place.street, place.streetNumber].filter(Boolean).join(' '),
              place.district || place.subregion || place.city,
              place.region,
              'Chile',
            ].filter(Boolean).join(', ');
          } catch { return ''; }
        }));
        if (!cancelled) setAddressSuggestions([...new Set(labels.filter((label) => label && normalizeDeliveryAddress(label) !== normalizeDeliveryAddress(queryText)))].slice(0, 5));
      } catch {
        if (!cancelled) setAddressSuggestions([]);
      } finally {
        if (!cancelled) setSearchingAddresses(false);
      }
    }, 650);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [address, routeFinished]);

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
        let localRouteId = await loadLocalRouteId();
        let timing = await loadLocalRouteTiming(localRouteId);
        if (timing.completedAt) {
          if (!autoCreateRouteRef.current) {
            autoCreateRouteRef.current = createLocalTodayRoute().finally(() => { autoCreateRouteRef.current = null; });
          }
          localRouteId = await autoCreateRouteRef.current;
          timing = await loadLocalRouteTiming(localRouteId);
        }
        const localStops = await loadStops(localRouteId);
        const localName = await loadLocalRouteName(localRouteId);
        const localOptimized = await loadLocalRouteOptimized(localRouteId);
        const localEndpoints = await loadLocalRouteEndpoints(localRouteId);
        setStartAddress(localEndpoints.startAddress);
        setEndAddress(localEndpoints.endAddress);
        setEndAtLastStop(localEndpoints.endAtLastStop);
        setRouteName(localName);
        setRouteId(localRouteId);
        setRouteOptimized(localOptimized);
        const loaded = localStops.map((stop, index) => ({
          id: stop.id, address: stop.address, sequence: stop.sequence ?? index + 1, displayNumber: stop.displayNumber ?? String(stop.sequence ?? index + 1),
          status: stop.status ?? 'pending', failureReason: stop.failureReason ?? null, proofPhotoUrl: null,
          customerCount: stop.customerCount ?? 0, recordCount: stop.recordCount ?? stop.packageCount ?? 0, note: stop.note ?? '', customerPhone: stop.customerPhone ?? '', customerName: stop.customerName ?? '',
        })).sort((left, right) => left.sequence - right.sequence);
        setStops(loaded);
        setActiveStopId(loaded.find((stop) => stop.status === 'pending')?.id ?? null);
        setRouteStartedAt(timing.startedAt);
        setRouteFinished(Boolean(timing.completedAt));
        setRouteStarted(Boolean(timing.startedAt && !timing.completedAt));
      } else if (currentUser) {
        let route = await loadTodayRoute(currentUser.uid);
        if (route?.status === 'completed') {
          if (!autoCreateRouteRef.current) {
            autoCreateRouteRef.current = createTodayRoute(currentUser.uid).finally(() => { autoCreateRouteRef.current = null; });
          }
          await autoCreateRouteRef.current;
          route = await loadTodayRoute(currentUser.uid);
        }
        setRouteId(route?.id ?? null);
        setRouteName(route?.name ?? 'Ruta del día');
        setStartAddress(route?.startAddress ?? '');
        setEndAddress(route?.endAddress ?? '');
        setEndAtLastStop(route?.endAtLastStop ?? true);
        const loaded = route?.deliveries ?? [];
        setRouteOptimized(Boolean(route?.isOptimized));
        setStops(loaded);
        setActiveStopId(loaded.find((stop) => stop.status === 'pending')?.id ?? null);
        setRouteStartedAt(route?.startedAt ?? null);
        setRouteFinished(route?.status === 'completed');
        setRouteStarted(Boolean(route?.startedAt && route.status !== 'completed'));
      } else {
        setRouteId(null);
        setRouteOptimized(false);
        setRouteName('Ruta del día');
        setStartAddress('');
        setEndAddress('');
        setEndAtLastStop(true);
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

  // Keep the optimized/package sequence stable as delivery status changes.
  // Tabs filter the route but never move a stop to a different position.
  const displayedStops = useMemo(() => [...stops].sort((left, right) => left.sequence - right.sequence), [stops]);
  const pendingStops = useMemo(() => displayedStops.filter((stop) => stop.status === 'pending'), [displayedStops]);
  const visitedStops = useMemo(() => displayedStops.filter((stop) => stop.status !== 'pending'), [displayedStops]);
  const activeStop = stops.find((stop) => stop.id === activeStopId && stop.status === 'pending') ?? pendingStops[0] ?? null;
  const selectedStop = selectedStopId ? stops.find((stop) => stop.id === selectedStopId) ?? null : null;
  const visibleStops = stopListTab === 'visited' ? visitedStops : stopListTab === 'all' ? displayedStops : pendingStops;

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

  function showStatusConfirmation(message: string) {
    if (routeStarted && liveNavigationVisible) showNextStopNotice(message);
    else setStorageError(message);
  }

  useEffect(() => {
    if (photoPromptActive) return;
    if (!routeStarted) {
      if (notificationStopIdRef.current !== null) {
        notificationStopIdRef.current = null;
        void clearNextStopNotification();
      }
      return;
    }
    const active = stops.find((stop) => stop.id === activeStopId && stop.status === 'pending') ?? null;
    if ((active?.id ?? null) === notificationStopIdRef.current) return;
    notificationStopIdRef.current = active?.id ?? null;
    void showNextStopNotification(active);
  }, [activeStopId, photoPromptActive, routeStarted, stops]);

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

  async function persistLocal(nextStops: Delivery[], selectedRouteId = routeId ?? undefined) {
    const localStops: Stop[] = nextStops.map((stop) => ({
      id: stop.id, address: stop.address, createdAt: new Date().toISOString(), sequence: stop.sequence, displayNumber: stop.displayNumber,
      status: stop.status, failureReason: stop.failureReason, customerPhone: stop.customerPhone ?? '', customerName: stop.customerName ?? '', customerCount: stop.customerCount ?? 0,
      recordCount: stop.recordCount ?? 0, note: stop.note ?? '',
    }));
    await saveStops(localStops, selectedRouteId);
  }

  async function addStop(confirmedDisplayNumber?: string) {
    const trimmedAddress = address.trim();
    if (routeFinished) {
      setStorageError('Esta jornada ya terminó. Podrás iniciar una nueva ruta mañana.');
      return;
    }
    if (!trimmedAddress || busy) return;
    const existingAddress = stops.find((stop) => normalizeDeliveryAddress(stop.address) === normalizeDeliveryAddress(trimmedAddress));
    if (routeOptimized && !existingAddress && !confirmedDisplayNumber) {
      setBusy(true);
      setStorageError('');
      try {
        const target = (await Location.geocodeAsync(`${trimmedAddress}, Santiago, Chile`))[0];
        if (!target) throw new Error('address-not-located');
        const ordered = [...stops].sort((left, right) => left.sequence - right.sequence);
        const located: Array<{ stop: Delivery; latitude: number; longitude: number }> = [];
        for (const stop of ordered) {
          const result = (await Location.geocodeAsync(`${stop.address}, Santiago, Chile`))[0];
          if (result) located.push({ stop, latitude: result.latitude, longitude: result.longitude });
          await new Promise((resolve) => setTimeout(resolve, 180));
        }
        if (!located.length) throw new Error('stops-not-located');
        const nearest = located.reduce((best, item) => Math.hypot(item.latitude - target.latitude, item.longitude - target.longitude) < Math.hypot(best.latitude - target.latitude, best.longitude - target.longitude) ? item : best);
        const base = Math.floor(nearest.stop.sequence);
        const used = new Set(stops.map((stop) => stop.displayNumber));
        let candidate = Math.max(nearest.stop.sequence + 0.1, base + 0.1);
        while (candidate < base + 1 && used.has(candidate.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))) candidate += 0.1;
        if (candidate >= base + 1) {
          candidate = nearest.stop.sequence + 0.01;
          while (used.has(candidate.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))) candidate += 0.01;
        }
        const proposed = candidate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        setSuggestedStopNumber(proposed);
        setSuggestedStopAddress(nearest.stop.address);
        setPlacementPreviewAddress(trimmedAddress);
        setSelectedStopNumber(proposed);
        setAddStopPlacementVisible(true);
      } catch {
        setStorageError('No pudimos ubicar la nueva dirección para sugerir dónde insertarla. Comprueba la dirección y vuelve a intentarlo.');
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    setStorageError('');
    try {
      if (existingAddress) {
        const next = stops.map((stop) => stop.id === existingAddress.id ? { ...stop, recordCount: Math.max(1, stop.recordCount ?? 0) + 1 } : stop);
        if (isFirebaseConfigured && user) await incrementDeliveryRecordCount(user.uid, existingAddress.id, routeId ?? undefined);
        else if (isFirebaseConfigured) {
          setStorageError('Inicia sesión en Cuenta para guardar tus paradas en la nube.');
          return;
        } else await persistLocal(next);
        setStops(next);
        setStorageError('La dirección ya estaba en tu ruta: agrupé este pedido en la misma parada.');
      } else if (isFirebaseConfigured && user) {
        const created = await addDeliveryToTodayRoute(user.uid, trimmedAddress, { recordCount: 1, ...(confirmedDisplayNumber ? { displayNumber: confirmedDisplayNumber } : {}) }, routeId ?? undefined);
        setStops((current) => [...current, created].sort((left, right) => left.sequence - right.sequence));
        setRouteOptimized(Boolean(confirmedDisplayNumber && routeOptimized));
        if (!activeStopId && created.status === 'pending') setActiveStopId(created.id);
      } else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión en Cuenta para guardar tus paradas en la nube.');
        return;
      } else {
        const sequence = confirmedDisplayNumber ? Number(confirmedDisplayNumber) : Math.max(0, ...stops.map((stop) => stop.sequence)) + 1;
        const created: Delivery = { id: `${Date.now()}`, address: trimmedAddress, sequence, displayNumber: confirmedDisplayNumber ?? String(sequence), status: 'pending', failureReason: null, proofPhotoUrl: null, customerCount: 0, recordCount: 1, note: '', customerPhone: '', customerName: '' };
        const next = [...stops, created].sort((left, right) => left.sequence - right.sequence);
        await persistLocal(next);
        setStops(next);
        const optimized = Boolean(confirmedDisplayNumber && routeOptimized);
        await saveLocalRouteOptimized(optimized, routeId ?? undefined);
        setRouteOptimized(optimized);
        if (!activeStopId) setActiveStopId(created.id);
      }
      setAddress('');
      setAddStopPlacementVisible(false);
    } catch (error) {
      console.error('No se pudo guardar la parada:', error);
      if (describeOperationError(error) === 'route-completed') {
        try {
          if (!isFirebaseConfigured || !user) throw new Error('route-recovery-unavailable');
          const newRouteId = await createTodayRoute(user.uid);
          const created = await addDeliveryToTodayRoute(user.uid, trimmedAddress, { recordCount: 1 }, newRouteId);
          setRouteId(newRouteId);
          setRouteName('Ruta del día');
          setStops([created]);
          setRouteOptimized(false);
          setRouteStarted(false);
          setRouteStartedAt(null);
          setRouteFinished(false);
          setLiveNavigationVisible(false);
          setStartAddress('');
          setEndAddress('');
          setEndAtLastStop(true);
          setActiveStopId(created.id);
          setSelectedStopId(null);
          setStorageError('La ruta anterior estaba cerrada. Abrí una nueva y guardé esta parada.');
          setAddress('');
          setAddStopPlacementVisible(false);
          return;
        } catch (recoveryError) {
          setStorageError(`La ruta anterior terminó y no pude sincronizar una nueva. Código: ${describeOperationError(recoveryError)}.`);
          return;
        }
      }
      setStorageError(`No se pudo guardar la parada. Código: ${describeOperationError(error)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function chooseCsvFile() {
    if (busy || isLoading || isReadingFile) return;
    setStorageError('');
    setImportPreview(null);
    setIsReadingFile(true);
    let copiedFileUri: string | null = null;
    let selectedExtension: string | undefined;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: false,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const extension = file.name.toLowerCase().split('.').pop();
      selectedExtension = extension;
      if (!['pdf', 'csv', 'xlsx', 'xls'].includes(extension ?? '')) {
        setStorageError('Elige un PDF, un archivo Excel (.xlsx o .xls) o CSV.');
        return;
      }
      if ((file.size ?? 0) > 25 * 1024 * 1024) {
        setStorageError('El archivo supera el límite de 25 MB.');
        return;
      }
      if (!FileSystem.cacheDirectory) throw new Error('No está disponible el caché local de la aplicación.');
      copiedFileUri = `${FileSystem.cacheDirectory}connect-import-${Date.now()}.${extension}`;
      await FileSystem.copyAsync({ from: file.uri, to: copiedFileUri });
      let addresses: ImportedAddress[];
      if (extension === 'csv') {
        addresses = parseCsvAddresses(await FileSystem.readAsStringAsync(copiedFileUri));
      } else if (extension === 'pdf') {
        const pdfBytes = await readPickedFileBytes(copiedFileUri);
        if (file.size && pdfBytes.byteLength !== file.size) {
          throw new Error(`El PDF quedó incompleto al copiarlo (${pdfBytes.byteLength} de ${file.size} bytes).`);
        }
        if (String.fromCharCode(...pdfBytes.subarray(0, 5)) !== '%PDF-') {
          throw new Error('El archivo seleccionado no conserva la firma PDF después de copiarlo.');
        }
        addresses = parseAddressRows(await extractPdfAddressRows(pdfBytes));
      } else {
        const workbookBytes = await readPickedFileBytes(copiedFileUri);
        const workbook = XLSX.read(workbookBytes, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
        const rows = worksheet
          ? XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '' })
          : [];
        addresses = parseAddressRows(rows.map((row) => row.map((cell) => String(cell ?? ''))));
      }
      if (addresses.length === 0) {
        setStorageError('No encontramos direcciones. En PDF, usa un documento con texto seleccionable y filas de direcciones; en Excel o CSV, usa una columna llamada Dirección o la primera columna.');
        return;
      }
      const existing = new Set((routeFinished ? [] : stops).map((stop) => normalizeDeliveryAddress(stop.address)));
      const newAddresses = addresses.filter((item) => !existing.has(normalizeDeliveryAddress(item.address)));
      if (newAddresses.length === 0) {
        setStorageError('Todas las direcciones del archivo ya están en la ruta.');
        return;
      }
      setImportPreview(newAddresses);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error de lectura';
      if (selectedExtension === 'pdf' && /texto seleccionable|escanead[oa]/i.test(detail)) {
        setStorageError('Este PDF parece ser un escaneo sin texto seleccionable. Necesita OCR; prueba exportar la hoja a Excel/CSV o usar un PDF con texto.');
      } else if (selectedExtension === 'pdf') {
        setStorageError(`No se pudo procesar este PDF en el teléfono. Exporta la hoja de viaje como Excel o CSV e impórtala. Detalle: ${detail}`);
      } else {
        setStorageError(`No se pudo abrir el archivo. ${detail}`);
      }
    } finally {
      if (copiedFileUri) {
        try {
          await FileSystem.deleteAsync(copiedFileUri, { idempotent: true });
        } catch {
          // The temporary file is in the app cache; cleanup failure must not hide import results.
        }
      }
      setIsReadingFile(false);
    }
  }

  async function importCsvAddresses() {
    if (!importPreview?.length || busy) return;
    if (isFirebaseConfigured && !user) {
      setStorageError('Inicia sesión en Cuenta para importar las paradas a Firebase.');
      return;
    }
    setBusy(true);
    setStorageError('');
    try {
      let targetRouteId = routeId ?? undefined;
      if (routeFinished) {
        targetRouteId = isFirebaseConfigured && user
          ? await createTodayRoute(user.uid)
          : await createLocalTodayRoute();
        setRouteId(targetRouteId);
        setStops([]);
        setRouteFinished(false);
        setRouteStarted(false);
        setRouteStartedAt(null);
        setRouteOptimized(false);
        setStartAddress('');
        setEndAddress('');
        setEndAtLastStop(true);
        setActiveStopId(null);
      }
      let chooseActiveStop = !activeStopId;
      if (isFirebaseConfigured && user) {
        for (const item of importPreview) {
          const created = await addDeliveryToTodayRoute(user.uid, item.address, item, targetRouteId);
          setStops((current) => [...current, created].sort((left, right) => left.sequence - right.sequence));
          setRouteOptimized(false);
          setImportPreview((current) => current?.filter((entry) => normalizeDeliveryAddress(entry.address) !== normalizeDeliveryAddress(item.address)) ?? null);
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
          customerPhone: item.customerPhone ?? '',
          customerName: item.customerName ?? '',
          note: '',
          sequence: firstSequence + index,
          displayNumber: String(firstSequence + index),
          status: 'pending',
          failureReason: null,
          proofPhotoUrl: null,
        }));
        const next = [...stops, ...imported].sort((left, right) => left.sequence - right.sequence);
        await persistLocal(next, targetRouteId);
        setStops(next);
        const optimized = false;
        await saveLocalRouteOptimized(optimized, routeId ?? undefined);
        setRouteOptimized(optimized);
        if (chooseActiveStop) setActiveStopId(imported[0]?.id ?? null);
      }
      setImportPreview(null);
    } catch (error) {
      console.error('No se pudo completar la importación de paradas:', error);
      if (describeOperationError(error) === 'route-completed') {
        setRouteStarted(false);
        setRouteFinished(true);
        setStorageError('Esta ruta terminó durante la importación. Vuelve a elegir el Excel para crear una ruta nueva.');
        return;
      }
      if (describeOperationError(error) === 'permission-denied') {
        setStorageError('Firebase rechazó la importación. Hay que publicar las reglas de Firestore actualizadas para permitir los campos de nombre y teléfono. Revisa Por visitar antes de intentar de nuevo.');
        return;
      }
      setStorageError(`La importación se detuvo. Algunas paradas podrían haberse guardado. Código: ${describeOperationError(error)}.`);
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
      if (isFirebaseConfigured && user) await removeDeliveryFromTodayRoute(user.uid, stopId, routeId ?? undefined, routeOptimized);
      else await persistLocal(next);
      setStops(next);
      const optimized = next.length > 0 && (routeOptimized || (next.length === 1 && next[0].sequence === 1 && next[0].displayNumber === '1'));
      if (!isFirebaseConfigured) await saveLocalRouteOptimized(optimized, routeId ?? undefined);
      setRouteOptimized(optimized);
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
    if (!routeOptimized) {
      setStorageError('Primero optimiza la ruta. Después podrás marcar entregas y fallidas sin cambiar el orden de los paquetes.');
      return;
    }
    if (busy || routeFinished || stop.status !== 'pending') return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'delivered' as const, failureReason: null } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'delivered', null, routeId ?? undefined);
      else await persistLocal(next);
      setStops(next);
      if (!(routeStarted && activeStopId === stop.id)) showStatusConfirmation('Marcaste entregada.');

      // The delivery is saved first. Only ask for a photo while this address accepts contributions.
      const mayOfferPhoto = await canOfferParkingPhoto(stop.address).catch(() => false);
      if (mayOfferPhoto) {
        setPhotoPromptActive(true);
        const wantsPhoto = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Marcaste entregada',
            '¿Quieres aportar una foto del estacionamiento o acceso de esta dirección? Es opcional. La entrega ya quedó guardada.',
            [
              { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Aportar foto', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
        if (wantsPhoto) {
          router.push({ pathname: '/direcciones', params: { address: stop.address, fromDelivery: 'true', capturePhoto: 'true' } });
        }
      }

      if (routeStarted && activeStopId === stop.id) {
        const following = next.find((item) => item.sequence > stop.sequence && item.status === 'pending')
          ?? next.find((item) => item.status === 'pending')
          ?? null;
        setActiveStopId(following?.id ?? null);
        if (following) {
          showNextStopNotice(`Marcaste entregada · siguiente: parada ${following.displayNumber ?? following.sequence} de ${stops.length}`);
          notificationStopIdRef.current = following.id;
          await showNextStopNotification(following);
        } else {
          showNextStopNotice('Marcaste entregada · no quedan paradas pendientes');
          notificationStopIdRef.current = null;
          await clearNextStopNotification();
        }
      }
    } catch {
      setStorageError('No se pudo actualizar la entrega. Inténtalo de nuevo.');
    } finally {
      setPhotoPromptActive(false);
      setBusy(false);
    }
  }

  async function markFailed(stop: Delivery, reasonOverride?: string) {
    if (!routeOptimized) {
      setStorageError('Primero optimiza la ruta. Después podrás marcar entregas y fallidas sin cambiar el orden de los paquetes.');
      return;
    }
    const reason = reasonOverride?.trim() || failureReason.trim();
    if (busy || routeFinished) return;
    setBusy(true);
    try {
      const cleanReason = reason || null;
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'failed' as const, failureReason: cleanReason } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'failed', cleanReason, routeId ?? undefined);
      else await persistLocal(next);
      setStops(next);
      if (!(routeStarted && activeStopId === stop.id)) showStatusConfirmation('Marcaste fallida.');
      setFailureId(null);
      setFailureReason('');
      setFailurePromptStep('ask');
      if (routeStarted && activeStopId === stop.id) {
        const following = next.find((item) => item.sequence > stop.sequence && item.status === 'pending')
          ?? next.find((item) => item.status === 'pending')
          ?? null;
        setActiveStopId(following?.id ?? null);
        if (following) {
          showNextStopNotice(`Marcaste fallida · siguiente: parada ${following.displayNumber ?? following.sequence} de ${stops.length}`);
          notificationStopIdRef.current = following.id;
          await showNextStopNotification(following);
        } else {
          showNextStopNotice('Marcaste fallida · no quedan paradas pendientes');
          notificationStopIdRef.current = null;
          await clearNextStopNotification();
        }
      }
    } catch {
      setStorageError('No se pudo marcar la parada como fallida. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  function askFailureReason(stop: Delivery) {
    if (!routeOptimized) {
      setStorageError('Primero optimiza la ruta para habilitar los estados de entrega.');
      return;
    }
    setFailureId(stop.id);
    setFailureReason('');
    setFailurePromptStep('ask');
  }

  function cancelFailurePrompt() {
    setFailureId(null);
    setFailureReason('');
    setFailurePromptStep('ask');
  }

  function continueFailedWithoutReason() {
    const stop = stops.find((item) => item.id === failureId);
    if (stop) void markFailed(stop, '');
  }

  async function resetPending(stop: Delivery) {
    if (busy || routeFinished) return;
    setBusy(true);
    try {
      const next = stops.map((item) => item.id === stop.id ? { ...item, status: 'pending' as const, failureReason: null } : item);
      if (isFirebaseConfigured && user) await updateDeliveryStatus(user.uid, stop.id, 'pending', null, routeId ?? undefined);
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
      if (isFirebaseConfigured && user) await updateDeliveryNote(user.uid, stopId, note, routeId ?? undefined);
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

  async function saveCustomerPhone(stopId: string) {
    if (savingPhoneId) return;
    const phone = phoneDraft.trim().slice(0, 30);
    const next = stops.map((item) => item.id === stopId ? { ...item, customerPhone: phone } : item);
    setSavingPhoneId(stopId);
    setStorageError('');
    try {
      if (isFirebaseConfigured && user) {
        const { updateDeliveryPhone } = await import('@/lib/route-repository');
        await updateDeliveryPhone(user.uid, stopId, phone, routeId ?? undefined);
      } else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión en Cuenta para guardar el teléfono del cliente.');
        return;
      } else await persistLocal(next);
      setStops(next);
      setEditingPhoneId(null);
      setSavedPhoneId(stopId);
      setTimeout(() => setSavedPhoneId((current) => current === stopId ? null : current), 2200);
    } catch (error) {
      setStorageError(`No se pudo guardar el teléfono. Código: ${describeOperationError(error)}.`);
    } finally {
      setSavingPhoneId(null);
    }
  }

  async function openCustomerContact(stop: Delivery, target: 'call' | 'whatsapp') {
    const phone = (stop.customerPhone ?? '').replace(/[^+\d]/g, '');
    if (!phone) return;
    const url = target === 'call' ? `tel:${phone}` : `https://wa.me/${phone.replace(/^\+/, '')}`;
    try {
      await Linking.openURL(url);
    } catch {
      setStorageError(target === 'call' ? 'No se pudo abrir la aplicación de teléfono.' : 'No se pudo abrir WhatsApp para este número.');
    }
  }

  async function shareCurrentRoute() {
    if (stops.length === 0) return;
    if (!routeOptimized) {
      setStorageError('Optimiza la ruta antes de compartirla para que los números coincidan con tus paquetes.');
      return;
    }
    if (!isFirebaseConfigured || !user) {
      setStorageError('Inicia sesión en Connect para crear un enlace HTTPS que puedas compartir.');
      return;
    }
    const ordered = [...stops].sort((left, right) => left.sequence - right.sequence);
    const title = repairMojibake(routeName);
    const sharedRoute = {
      name: repairMojibake(routeName),
      stops: ordered.map((stop) => ({
        address: repairMojibake(stop.address),
        packageNumber: stop.displayNumber ?? String(stop.sequence),
        customerName: stop.customerName ?? '',
        customerPhone: stop.customerPhone ?? '',
        status: stop.status,
      })),
    };
    try {
      const shareId = await createSharedRouteLink(user.uid, sharedRoute);
      const link = `https://oliva-connect-cybmzx-rutas.web.app/r/${shareId}`;
      await Share.share({ title, message: `${title}: ${link}` });
    } catch {
      setStorageError('No se pudo crear el enlace de ruta. Revisa la conexión e inténtalo otra vez.');
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
    if (!routeStarted) {
      await startRouteAt(stop);
      return;
    }
    if (stop.status === 'pending') setActiveStopId(stop.id);
    if (navigationProvider === 'inside') {
      setLiveNavigationVisible(true);
      return;
    }
    if (stop.status === 'pending') {
      notificationStopIdRef.current = stop.id;
      await showNextStopNotification(stop);
    }
    await openNavigation(stop);
  }

  async function startRouteAt(firstPending: Delivery) {
    if (routeFinished) return;
    if (stops.length > 0 && !routeOptimized) {
      setStorageError('Optimiza la ruta antes de iniciarla. Así podrás escribir en cada paquete el número de parada correcto y compartir el mismo orden.');
      return;
    }
    const notificationsAllowed = await prepareRouteNotifications().catch(() => false);
    if (!notificationsAllowed) {
      Alert.alert('Activa las notificaciones', 'Connect necesita permiso para mostrar la dirección actual y el botón Entregado mientras usas el navegador. Puedes iniciar sin el panel de notificaciones.', [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Iniciar sin panel', onPress: () => { void beginRoute(firstPending); } },
        { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    await beginRoute(firstPending);
  }

  async function beginRoute(firstPending: Delivery) {
    try {
      const startedAt = Date.now();
      const persistedStartedAt = isFirebaseConfigured && user
        ? await markTodayRouteStarted(user.uid, routeId ?? undefined)
        : await saveLocalRouteStartedAt(startedAt, routeId ?? undefined);
      setRouteStartedAt(persistedStartedAt);
      setRouteFinished(false);
      setActiveStopId(firstPending.id);
      notificationStopIdRef.current = firstPending.id;
      await showNextStopNotification(firstPending);
      setRouteStarted(true);
      setLiveNavigationVisible(true);
      setStopListExpanded(false);
      showNextStopNotice(`Ruta iniciada · parada ${firstPending.displayNumber ?? firstPending.sequence} de ${stops.length}`);
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
      if (isFirebaseConfigured && user) await completeTodayRoute(user.uid, routeId ?? undefined);
      else if (isFirebaseConfigured) throw new Error('login-required');
      else await finishLocalRoute(completedAt, routeId ?? undefined);

      const summary = {
        elapsedMs: Math.max(0, completedAt - startedAt),
        delivered: stops.filter((stop) => stop.status === 'delivered').length,
        failed: stops.filter((stop) => stop.status === 'failed').length,
        pending: stops.filter((stop) => stop.status === 'pending').length,
      };
      setRouteSummary(summary);
      setRouteStarted(false);
      setLiveNavigationVisible(false);
      setRouteFinished(true);
      notificationStopIdRef.current = null;
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

  async function startAnotherRoute() {
    if (busy || !routeFinished) return;
    setBusy(true);
    setStorageError('');
    try {
      if (isFirebaseConfigured && !user) throw new Error('login-required');
      const newRouteId = isFirebaseConfigured && user
        ? await createTodayRoute(user.uid)
        : await createLocalTodayRoute();
      setRouteId(newRouteId);
      setStops([]);
      setStartAddress('');
      setEndAddress('');
      setEndAtLastStop(true);
      setRouteOptimized(false);
      setActiveStopId(null);
      setSelectedStopId(null);
      setRouteStartedAt(null);
      setRouteStarted(false);
      setLiveNavigationVisible(false);
      setRouteFinished(false);
      setImportPreview(null);
      setRouteSummary(null);
      setcode === 'permission-denied'
          ? 'Firebase rechazó crear la ruta (permission-denied). Hay que publicar las reglas de Firestore actualizadas en Firebase Console.'
          : `No se pustops.filter((stop) => stop.status === 'pending').length;
    Alert.alert(
      'Terminar ruta',
      pending > 0 ? `Quedan ${pending} paradas pendientes. ¿Quieres terminar la ruta y guarda'pending');
    if (!firstPending) {
      setStorageError('Agrega una parada pendiente antes de iniciar la ruta.');
      return;
    }
    await startRouteAt(firstPending);
  }

  function c   const nextEndAddress = useLastStop ? '' : (favoriteAddress ?? endAddress).trim();
    if (!useLastStop && !nextEndAddress) {
      setStorageError('Escribe el domicilio final o elige un favorito.');
      return;
    }
    setEndAtLastStop(useLastStop);
    setEndAddress(nextEndAddress);
    setFinalPointDialogVisible(false);
    try {
      if (isFirebaseConfigured && user) awa    let origin: { latitude: number; longitude: number } | null = null;
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.granted) {
        try {
          const currentPosition = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          origin = { latitude: currentPosition.coords.latitude, longitude: currentPosition.coords.longitude };
          setGpsOrigin(origin);
        } catch { setStorageError('No pudimos leer el GPS. Se usará la primera parada como inicio provisional.'); }
      } else {
        setStorageError('Sin permiso GPS, se usará la primera parada del archivo como inicio provisional.');
      }

      const coordinates = new Map<string, { latitude: number; longitude: number }>();
      const orderedByCurrentSequence = [...stops].sort((left, right) => left.sequence - right.sequence);
      for (const [index, stop] of orderedByCurrentSequence.entries()) {
        try {
          const result = (await Location.geocodeAsync(`${stop.address}, Santiago, Chile`))[0];
          if (result) coordinates.set(stop.id, { latitude: result.latitude, entSequence.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const missing = orderedByCurrentSequence.filter((stop) => !coordinates.has(stop.id));
      if (missing.length > 0) {
        setStorageError(`No pude ubicar ${missing.length} parada(s). Revisa que cada dirección tenga número y comuna.`);
        return;
      }

      const remaining = [...orderedByCurrentSequence];
      let firstIndex = 0;
      if (origin) {
        let firstDistance = Number.POSITIVE_INFINITY;
        remaining.forEach((candidate, index) => {
          const point = coordinates.get(candidate.id)!;
          const distance = Math.hypot(point.latitude - origin!.latitude, point.longitude - origin!.longitude);
          if (distance < firstDistance) { firstDistance = distance; firstIndex = index; }
        });
      }
      const ordered = [remaining.splice(firstIndex, 1)[0]];
      while (remaining.length) {
        const current estDistance) { nearestDistance = distance; nearestIndex = index; }
        });
        ordered.push(remaining.splice(nearestIndex, 1)[0]);
      }
      confirmApproximateOrder(ordered.map((st=> byId.has(id) ? [byId.get(id)!] : []);
    const next = ordered.map((stop, index) => ({ ...stop, sequence: index + 1, displayNumber: String(index + 1) }));
    try {
      if (isFirebaseConfigured && user) await updateDeliveryOrder(user.uid, next.map(({ id, sequence, displayNumber: number }) => ({ id, sequence, displayNumber: number })), routeId ?? undefined);
      else if (isFirebaseConfigured) {
        setStorageError('Inicia sesión para guardar el orden optimizado.');
        return;
      } else await persistLocal(next);
      if (!isFirebaseConfigured) await sonst value = target === 'start' ? startAddress : endAddress;
    if (!value.trim()) {
      setStorageError('Escribe primero la dirección que quieres guardar como favorita.');
      return;
 ait saveRouteFavorite(favoriteLabel, favoriteAddressDraft));
      setFavoriteDialogVisible(false);
      setStorageError('Dirección guardada en favoritos.');
    } catch {
      setStorageErble ? (
        <View style={styles.liveRouteScreen}>
          <View style={styles.liveRouteHeader}>
            <Pressable style={styles.liveListButton} onPress={() => setStopListExpanded(true)}><Text style={styles.liveListButtonText}>☰  Paradas</Text></Pressable>
            <Text style={styles.liveRouteTitle}>Ruta en curso</Text>
            <View style={styles.liveHeaderRight}><Text style={styles.liveProgress}>{activeStop ? (activeStop.displayNumber ?? activeStop.sequence) : stops.length} de {stops.length}</Text><Pressable style={styles.liveBackButton} onPress={() => { setStopListExpanded(false); setLiveNavigationVisible(false); }} accessibilityRole="button" accessibilityLabel="Volver a la planificación de la ruta"><Text style={styles.liveBackButtonText}>×</Text></Pressable></View>
          </View>
        <RouteMap expanded stops={stops} activeStopId={activeStop?.id} selectedStopId={selectedStopId} routeStarted onSelectStop={setSelectedStopId} endAddress={endAtLastStop ? '' : endAddress} gpsOrigin={gpsOrigin} placementPreviewAddress={placementPreviewAddress} />
          <View style={styles.liveStopCard}>
            {Boolean(nextStopNotice) && <Animated.View style={[styles.nextStopNotice, { opacity: nextStopNoticeOpacity, transform: [{ translateY: nextStopNoticeOffset }] }]}><Text style={styles.nextStopNoticeText}>✓  {nextStopNotice}</Text></Animated.View>}
            <Text style={styles.liveStopEyebrow}>{activeStop ? `PARADA ${activeStop.displayNumber ?? activeStop.sequence} DE ${stops.length}` : 'RUTA'}</Text>
            <Text style={styles.liveStopAddress}>{activeStop?.address ?? 'No quedan paradas pendientes'}</Text>
            {!!activeStop?.note?.trim() && <Text style={styles.liveStopNote}>Paquetes: {activeStop.note}</Text>}
            {activeStop && <Pressable style={styles.liveNavigateButton} onPress={() => void navigateToStop(activeStop)} accessibilityRole="button" accessibilityLabel={`Navegar a ${activeStop.address}`}><Text style={styles.liveNavigateButtonText}>↗  Navegar</Text></Pressable>}
            {activeStop ? <View style={styles.liveActionRow}>
              <Pressable style={[styles.deliveredButton, styles.liveActionButton, (!routeOptimized || busy) && styles.disabledButton]} onPress={() => void markDelivered(activeStop)} disView>
            <Text style={styles.workflowLabel}>Añade paradas</Text>
          </View>
          <View style={styles.workflowConnector} />
          <View style={styles.workflowStep}>
            <View style={[styles.workflowNumber, stops.length > 1 && !routeStarted && styles.workflowNumberActive]}><Text style={[styles.workflowNumberText, stops.length > 1 && !routeStarted && styles.workflowNumberTextActive]}>2</Text></View>
            <Text style={styles.workflowLabel}>Optimiza</Text>
          </View>
          <View style={styles.workflowConnector} />
          <View style={styles.workflowStep}>
            <View style={[styles.workflowNumber, (routeStarted || routeFinished) && styles.workflowNumberActive]}><Text style={[styles.workflowNumberText, (routeStarted || routeFinished) && styles.workflowNumberTextActive]}>3</Text></View>
            <Text style={styles.workflowLabel}>Navega</Text>
          </View>
        </View>

        <RouteMap stops={stops} activeStopId={activeStopId} selectedStopId={selectedStopId} routeStarted={routeStarted} onSelectStop={setSelectedStopId} endAddress={endAtLastStop ? '' : endAddress} gpsOrigin={gpsOrigin} placementPreviewAddress={placementPreviewAddress} />

        {!!storageError && <Animated.View accessibilityRole="alert" style={[styles.toast, { opacity: toastOpacity, transform: [{ translateY: toastOffset }] }]}>
          <View style={[styles.toastAccent, (storageError.startsWith('La dirección ya estaba') || storageError.startsWith('Marcaste ')) && styles.toastSuccessAccent]} />
          <Text style={[styles.toastMessage, (storageError.startsWith('La dirección ya estaba') || storageError.startsWith('Marcaste ')) && styles.toastSuccessMessage]}>{storageError}</Text>
          <Pressable onPress={() => setStorageError('')} hitSlop={10} accessibilityLabel="Cerrar aviso" style={styles.toastClose}>
            <Text style={styles.toastCloseText}>×</Text>
          </Pressable>
        </Animated.View>}

        <View style={styles.inputCard}>
          {!routeFinished && <><Text style={styles.inputLabel}>DIRECCIÓN DE LA PARADA</Text>
          <TextInput value={address} onChangeText={setAddress} placeholder="Ej.: Av. Los Olivos 123, Santiago" placeholderTextColor="#91A098" style={styles.input} returnKeyType="done" onSubmitEditing={() => void addStop()} />
          {searchingAddresses && <Text style={styles.addressSearchHint}>Buscando coincidencias cercanas…</Text>}
          {addressSuggestions.map((suggestion) => <Pressable key={suggestion} style={styles.addressSuggestion} onPress={() => { selectedAddressSuggestionRef.current = true; setAddress(suggestion); setAddressSuggestions([]); }}><Text style={styles.addressSuggestionIcon}>⌖</Text><Text style={styles.addressSuggestionText}>{suggestion}</Text></Pressable>)}
          <Pressable style={[styles.addButton, (isLoading || busy) && styles.disabledButton]} onPress={() => void addStop()} disabled={isLoading || busy}>
            <Text style={styles.addButtonText}>{busy ? routeOptimized ? 'Buscando ubicación…' : 'Guardando…' : '＋  Añadir parada'}</Text>
          </Pressable></>}
          <Pressable style={[styles.importButton, (isLoading || busy || isReadingFile) && styles.disabledButton]} onPress={chooseCsvFile} disabled={isLoading || busy || isReadingFile}>
          <Text style={styles.importButtonText}>{isReadingFile ? 'Abriendo archivo…' : routeFinished ? 'Importar archivo a una ruta nueva' : 'Importar PDF, Excel o CSV'}</Text>
          </Pressable>
          <Text style={styles.csvHint}>Admite PDF con texto seleccionable, .xlsx, .xls y .csv.</Text>
        </View>

        {importPreview && <View style={styles.previewCard}>
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
        {(stops.length > 0 || routeFinished) && <View style={styles.navigationCard}>
          <Text style={styles.navigationTitle}>{routeFinished ? 'Ruta terminada' : routeStarted ? 'Ruta iniciada' : '¿Listo para salir?'}</Text>
          {!routeFinished && <Text style={styles.navigationHint}>{routeStarted ? 'La ruta sigue activa. Volver a esta pantalla no cierra la jornada ni cambia el orden de las paradas.' : 'Al entregar la parada activa, Connect avanzará a la siguiente.'}</Text>}
          {!routeFinished && <View style={styles.providerRow}>
            {([['inside', 'Mapa integrado'], ['google', 'Google Maps'], ['waze', 'Waze']] as const).map(([provider, label]) => <Pressable key={provider} onPress={() => { setNavigationProvider(provider); void setMap(provider); }} style={[styles.providerButton, navigationProvider === provider && styles.providerSelected]}><Text style={[styles.providerText, navigationProvider === provider && styles.providerTextSelected]}>{label}</Text></Pressable>)}
          </View>}
          {!routeFinished && <Pressable style={styles.startButton} onPress={() => routeStarted ? setLiveNavigationVisible(true) : void startRoute()}><Text style={styles.startButtonText}>{routeStarted ? 'Reanudar navegación' : 'Iniciar ruta'}</Text></Pressable>}
          {routeFinished && <Text style={styles.finishedHint}>El resumen de esta jornada quedó guardado en Historial.</Text>}
          {routeFinished && <Pressable style={styles.startButton} onPress={() => void startAnotherRoute()} disabled={busy}><Text style={styles.startButtonText}>{busy ? 'Creando ruta…' : '＋  Crear otra ruta hoy'}</Text></Pressable>}
        </View>}
        <View style={styles.listHeader}>
          <View style={styles.listTitleRow}><Text style={styles.listHeading}>{routeFinished ? 'Ruta cerrada' : 'Paradas de hoy'}</Text><Text style={styles.stopCount}>{stops.length}</Text></View>
        <View style={styles.listHeaderActions}><Pressable hitSlop={8} onPress={() => void shareCurrentRoute()} disabled={stops.length === 0 || !routeOptimized}><Text style={[styles.historyLink, (stops.length === 0 || !routeOptimized) && styles.historyLinkDisabled]}>{routeOptimized ? 'Compartir ↗' : 'Optimiza para compartir'}</Text></Pressable><Link href="/historial" asChild><Pressable hitSlop={8}><Text style={styles.historyLink}>Historial →</Text></Pressable></Link></View>
        </View>
        <View style={styles.stopTabs}>
          <Pressable style={[styles.stopTab, stopListTab === 'pending' && styles.stopTabActive]} onPress={() => setStopListTab('pending')}><Text style={[styles.stopTabText, stopListTab === 'pending' && styles.stopTabTextActive]}>Por visitar · {pendingStops.length}</Text></Pressable>
          <Pressable style={[styles.stopTab, stopListTab === 'visited' && styles.stopTabActive]} onPress={() => setStopListTab('visited')}><Text style={[styles.stopTabText, stopListTab === 'visited' && styles.stopTabTextActive]}>Visitadas · {visitedStops.length}</Text></Pressable>
          <Pressable style={[styles.stopTab, stopListTab === 'all' && styles.stopTabActive]} onPress={() => setStopListTab('all')}><Text style={[styles.stopTabText, stopListTab === 'all' && styles.stopTabTextActive]}>Todas · {stops.length}</Text></Pressable>
        </View>
        {routeFinished && <Text style={styles.finishedHint}>Esta ruta está cerrada. Las paradas pendientes quedan guardadas en el resumen y ya no se pueden marcar ni editar desde aquí.</Text>}
        {routeFinished && visitedStops.length > 0 && <Pressable style={styles.visitedToggle} onPress={() => setVisitedStopsExpanded((expanded) => !expanded)}><Text style={styles.visitedToggleText}>{visitedStopsExpanded ? '⌄ Ocultar' : '› Ver'} {visitedStops.filter((stop) => stop.status === 'delivered').length} entregadas · {visitedStops.filter((stop) => stop.status === 'failed').length} fallidas</Text></Pressable>}
        {stops.length > 0 && !routeOptimized && !routeStarted && !routeFinished && <Pressable style={[styles.optimizeRouteButton, isOptimizing && styles.disabledButton]} onPress={askForFinalPoint} disabled={isOptimizing}>
          <Text style={styles.optimizeRouteText}>{isOptimizing ? 'Calculando orden…' : 'Optimizar orden de paradas'}</Text>
        </Pressable>}
        {stops.length > 0 && !routeOptimized && !routeFinished && <Text style={styles.routeEstimate}>Optimiza la ruta para habilitar “Entregada” y “Fallida”.</Text>}
        {stops.length > 0 && <Text style={styles.routeEstimate}>Estimación de paradas: {Math.floor(stops.length / 60) > 0 ? `${Math.floor(stops.length / 60)} h ` : ''}{stops.length % 60} min · 1 minuto por parada, sin contar traslados.</Text>}
        {isLoading ? <Text style={styles.helper}>Cargando ruta…</Text> : stops.length === 0 ? (
          <View style={styles.emptyCard}><View style={styles.pin}><Text style={styles.pinText}>⌖</Text></View><Text style={styles.emptyTitle}>Tu lista está vacía</Text><Text style={styles.emptyDescription}>Escribe una dirección arriba para empezar.</Text></View>
        ) : visibleStops.length === 0 ? (
          <View style={styles.emptyListCard}><Text style={styles.emptyListTitle}>{stopListTab === 'pending' ? 'No quedan entregas por visitar' : 'Aún no hay domicilios visitados'}</Text><Text style={styles.emptyListText}>{stopListTab === 'pending' ? 'Las entregas marcadas aparecerán en Visitadas.' : 'Al marcar una parada como entregada o fallida, aparecerá aquí.'}</Text></View>
        ) : visibleStops.map((stop, index) => (
          <View key={stop.id} style={[styles.stopCard, stop.status === 'delivered' && styles.stopCardDelivered, stop.status === 'failed' && styles.stopCardFailed, selectedStopId === stop.id && styles.stopCardSelected]}>
            <View style={styles.stopTop}>
              <Pressable style={styles.stopIdentity} onPress={() => setSelectedStopId(stop.id)} accessibilityRole="button" accessibilityLabel={`Seleccionar parada ${stop.displayNumber ?? stop.sequence}: ${stop.address}`} accessibilityState={{ selected: selectedStopId === stop.id }}>
                <View style={[styles.stopSelectionBox, selectedStopId === stop.id && styles.stopSelectionBoxActive]}><Text style={styles.stopSelectionCheck}>{selectedStopId === stop.id ? '✓' : ''}</Text></View><View style={styles.stopNumber}><Text style={styles.stopNumberText}>{stop.displayNumber ?? String(stop.sequence || index + 1)}</Text></View>
                <View style={styles.addressCopy}><Text style={styles.stopAddress}>{stop.address}</Text>{!!stop.customerName?.trim() && <Text style={styles.customerName}>{stop.customerName}</Text>}<Text style={styles.customerCount}>{stop.customerCount > 0 ? `${stop.customerCount} ${stop.customerCount === 1 ? 'cliente' : 'clientes'}` : stop.recordCount > 0 ? `${stop.recordCount} ${stop.recordCount === 1 ? 'pedido agrupado' : 'pedidos agrupados'}` : 'Cliente sin identificar'}</Text></View>
              </Pressable>
            {!routeFinished && <Pressable onPress={() => confirmRemoveStop(stop)} hitSlop={10} accessibilityLabel={`Eliminar parada ${stop.displayNumber ?? index + 1}`}><Text style={styles.removeStop}>×</Text></Pressable>}
            </View>
            <Text style={[styles.status, stop.status === 'delivered' && styles.delivered, stop.status === 'failed' && styles.failed]}>
              {stop.status === 'delivered' ? 'Entregada' : stop.status === 'failed' ? `Fallida · ${stop.failureReason ?? ''}` : routeFinished ? 'Pendiente al cerrar la ruta' : 'Pendiente'}
            </Text>
            {!routeFinished && <Pressable style={styles.navigateStopButton} onPress={() => void navigateToStop(stop)} accessibilityLabel={`Navegar a ${stop.address}`}>
              <Text style={styles.navigateStopButtonText}>↗  Navegar a esta parada</Text>
            </Pressable>}
            {!routeFinished && (stop.status === 'pending' ? <View style={styles.actions}>
              <Pressable style={[styles.deliveredButton, !routeOptimized && styles.disabledButton]} onPress={() => void markDelivered(stop)} disabled={!routeOptimized}><Text style={styles.deliveredButtonText}>Marcar entregada</Text></Pressable>
              <Pressable style={[styles.failedButton, !routeOptimized && styles.disabledButton]} onPress={() => askFailureReason(stop)} disabled={!routeOptimized}><Text style={styles.failedButtonText}>Fallida</Text></Pressable>
            </View> : <Pressable onPress={() => resetPending(stop)}><Text style={styles.resetLink}>Deshacer</Text></Pressable>)}
            <View style={styles.phoneSection}>
              {editingPhoneId === stop.id ? <>
                <TextInput value={phoneDraft} onChangeText={setPhoneDraft} placeholder="Teléfono del cliente (ej.: +56 9...)" keyboardType="phone-pad" autoComplete="tel" maxLength={30} style={styles.phoneInput} />
                <View style={styles.phoneActions}><Pressable style={styles.contactButton} onPress={() => void saveCustomerPhone(stop.id)} disabled={savingPhoneId !== null}><Text style={styles.contactButtonText}>{savingPhoneId === stop.id ? 'Guardando…' : 'Guardar teléfono ✓'}</Text></Pressable><Pressable style={styles.phoneCancel} onPress={() => setEditingPhoneId(null)} disabled={savingPhoneId !== null}><Text style={styles.phoneCancelText}>Cancelar</Text></Pressable>{savedPhoneId === stop.id && <Text style={styles.phoneSaved}>Guardado ✓</Text>}</View>
              </> : stop.customerPhone?.trim() ? <View style={styles.phoneActions}><Text style={styles.phoneNumber}>☎ {stop.customerPhone}</Text><Pressable style={styles.contactButton} onPress={() => void openCustomerContact(stop, 'call')}><Text style={styles.contactButtonText}>Llamar</Text></Pressable><Pressable style={[styles.contactButton, styles.whatsappButton]} onPress={() => void openCustomerContact(stop, 'whatsapp')}><Text style={styles.contactButtonText}>WhatsApp</Text></Pressable>{!routeFinished && <Pressable onPress={() => { setPhoneDraft(stop.customerPhone ?? ''); setEditingPhoneId(stop.id); }}><Text style={styles.phoneEdit}>Editar</Text></Pressable>}</View> : !routeFinished && <Pressable style={styles.addPhoneButton} onPress={() => { setPhoneDraft(''); setEditingPhoneId(stop.id); }}><Text style={styles.addPhoneText}>＋ Añadir teléfono del cliente (opcional)</Text></Pressable>}
            </View>
            {!routeFinished && <View style={styles.noteEditor}>
              <Text style={styles.packageTip}>Recuerda anotar cuántos paquetes debes bajar.</Text>
              <TextInput value={stop.note ?? ''} onChangeText={(value) => { setSavedNoteId(null); setStops((current) => current.map((item) => item.id === stop.id ? { ...item, note: value } : item)); }} placeholder="Ej.: debo bajar 10 paquetes" placeholderTextColor="#91A098" style={styles.noteInput} maxLength={300} />
              <Pressable style={styles.noteSaveButton} onPress={() => void saveStopNote(stop.id)} disabled={savingNoteId !== null}><Text style={styles.noteSaveText}>{savingNoteId === stop.id ? 'Guardando…' : savedNoteId === stop.id ? 'Nota guardada ✓' : 'Guardar nota'}</Text></Pressable>
            </View>}
          </View>
        ))}
        {routeStarted && stops.length > 0 && <View style={styles.finishRouteSection}>
          <Text style={styles.finishRouteHint}>¿Ya completaste tu jornada?</Text>
          <Pressable style={styles.finishRouteButton} onPress={confirmFinishRoute} disabled={busy}><Text style={styles.finishRouteButtonText}>{busy ? 'Guardando…' : 'Terminar ruta'}</Text></Pressable>
        </View>}
        {!isFirebaseConfigured && <View style={styles.note}><Text style={styles.noteTitle}>Guardadas en este teléfono</Text><Text style={styles.noteText}>Cuando configures Firebase, estas paradas locales seguirán disponibles aquí y las nuevas se guardarán en tu cuenta.</Text></View>}
      </ScrollView>
      )}
    </SafeAreaView></ThemeLayer>
    <Modal visible={stopListExpanded && routeStarted} transparent animationType="slide" onRequestClose={() => setStopListExpanded(false)}>
      <View style={styles.stopListOverlay}>
        <View style={styles.stopListSheet}>
          <View style={styles.stopListHeader}><View><Text style={styles.stopListTitle}>Paradas de la ruta</Text><Text style={styles.stopListSubtitle}>{pendingStops.length} pendientes · {visitedStops.length} visitadas</Text></View><Pressable onPress={() => setStopListExpanded(false)} style={styles.stopListClose}><Text style={styles.stopListCloseText}>×</Text></Pressable></View>
          <View style={styles.stopListTabs}>
            <Pressable style={[styles.stopListTab, stopListTab === 'pending' && styles.stopListTabActive]} onPress={() => setStopListTab('pending')}><Text style={[styles.stopListTabText, stopListTab === 'pending' && styles.stopListTabTextActive]}>Por visitar · {pendingStops.length}</Text></Pressable>
            <Pressable style={[styles.stopListTab, stopListTab === 'visited' && styles.stopListTabActive]} onPress={() => setStopListTab('visited')}><Text style={[styles.stopListTabText, stopListTab === 'visited' && styles.stopListTabTextActive]}>Visitadas · {visitedStops.length}</Text></Pressable>
            <Pressable style={[styles.stopListTab, stopListTab === 'all' && styles.stopListTabActive]} onPress={() => setStopListTab('all')}><Text style={[styles.stopListTabText, stopListTab === 'all' && styles.stopListTabTextActive]}>Todas · {stops.length}</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.stopListContent}>
            {visibleStops.map((stop) => <Pressable key={stop.id} style={[styles.stopListRow, stop.id === activeStop?.id && styles.stopListRowActive, selectedStopId === stop.id && styles.stopListRowSelected]} onPress={() => setSelectedStopId(stop.id)} accessibilityRole="button" accessibilityLabel={`Seleccionar parada ${stop.displayNumber ?? stop.sequence}: ${stop.address}`} accessibilityState={{ selected: selectedStopId === stop.id }}>
              <Text style={styles.stopListNumber}>{stop.displayNumber ?? stop.sequence}</Text><View style={styles.stopListCopy}><Text style={styles.stopListAddress} numberOfLines={2}>{stop.address}</Text>{!!stop.note?.trim() && <Text style={styles.stopListNote} numberOfLines={1}>Paquetes: {stop.note}</Text>}</View><Text style={stop.status === 'pending' ? styles.stopListStatusPending : stop.status === 'delivered' ? styles.stopListStatusDone : styles.stopListStatusFailed}>{stop.status === 'pending' ? 'Pendiente' : stop.status === 'delivered' ? 'Entregada' : 'Fallida'}</Text><View style={[styles.stopSelectionBox, selectedStopId === stop.id && styles.stopSelectionBoxActive]}><Text style={styles.stopSelectionCheck}>{selectedStopId === stop.id ? '✓' : ''}</Text></View>
            </Pressable>)}
          </ScrollView>
          {selectedStop && <Pressable style={styles.stopListNavigateFloat} onPress={() => { setStopListExpanded(false); void navigateToStop(selectedStop); }} accessibilityRole="button" accessibilityLabel={`Navegar a parada ${selectedStop.displayNumber ?? selectedStop.sequence}`}><Text style={styles.stopListNavigateFloatText}>↗  Navegar · Parada {selectedStop.displayNumber ?? selectedStop.sequence}</Text></Pressable>}
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
    <Modal visible={failureId !== null} transparent animationType="fade" onRequestClose={cancelFailurePrompt}>
      <View style={styles.failureOverlay}>
        <View style={styles.failureDialog}>
          <Text style={styles.failureDialogTitle}>{failurePromptStep === 'ask' ? 'Entrega fallida' : 'Motivo de la entrega'}</Text>
          <Text style={styles.failureDialogText}>{failurePromptStep === 'ask' ? '¿Quieres agregar el motivo? Es opcional.' : 'Escribe brevemente por qué no se pudo entregar.'}</Text>
          {failurePromptStep === 'reason' && <TextInput value={failureReason} onChangeText={setFailureReason} placeholder="Ej.: cliente ausente, dirección incorrecta…" placeholderTextColor="#91A098" style={styles.failureDialogInput} maxLength={300} multiline autoFocus />}
          <View style={styles.failureDialogActions}>
            {failurePromptStep === 'ask' ? <>
              <Pressable style={styles.failureDialogSecondary} onPress={cancelFailurePrompt}><Text style={styles.failureDialogSecondaryText}>Cancelar</Text></Pressable>
              <Pressable style={styles.failureDialogSecondary} onPress={continueFailedWithoutReason} disabled={busy}><Text style={styles.failureDialogSecondaryText}>{busy ? 'Guardando…' : 'No, continuar'}</Text></Pressable>
              <Pressable style={styles.failureDialogPrimary} onPress={() => setFailurePromptStep('reason')}><Text style={styles.failureDialogPrimaryText}>Sí, agregar</Text></Pressable>
            </> : <>
              <Pressable style={styles.failureDialogSecondary} onPress={() => setFailurePromptStep('ask')}><Text style={styles.failureDialogSecondaryText}>Atrás</Text></Pressable>
              <Pressable style={styles.failureDialogPrimary} onPress={() => { const stop = stops.find((item) => item.id === failureId); if (stop && failureReason.trim()) void markFailed(stop); }} disabled={busy || !failureReason.trim()}><Text style={styles.failureDialogPrimaryText}>{busy ? 'Guardando…' : 'Guardar motivo'}</Text></Pressable>
            </>}
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={favoriteDialogVisible} transparent animationType="fade" onRequestClose={() => setFavoriteDialogVisible(false)}>
      <View style={styles.failureOverlay}>
        <View style={styles.failureDialog}>
          <Text style={styles.failureDialogTitle}>Guardar dirección favorita</Text>
          <Text style={styles.failureDialogText}>{favoriteAddressDraft}</Text>
          <TextInput value={favoriteLabel} onChangeText={setFavoriteLabel} placeholder="Nombre, por ejemplo Mi casa" placeholderTextColor="#91A098" style={styles.failureDialogInput} maxLength={40} autoFocus />
          <View style={styles.failureDialogActions}>
            <Pressable style={styles.failureDialogSecondary} onPress={() => setFavoriteDialogVisible(false)}><Text style={styles.failureDialogSecondaryText}>Cancelar</Text></Pressable>
            <Pressable style={styles.failureDialogPrimary} onPress={() => void confirmSaveFavorite()}><Text style={styles.failureDialogPrimaryText}>Guardar</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={finalPointDialogVisible} transparent animationType="fade" onRequestClose={() => setFinalPointDialogVisible(false)}>
      <View style={styles.failureOverlay}>
        <View style={styles.failureDialog}>
          <Text style={styles.failureDialogTitle}>¿Dónde termina la ruta?</Text>
          <Text style={styles.failureDialogText}>El inicio se toma desde el GPS donde estés. Elige terminar en la última entrega o agrega un destino final.</Text>
          <Pressable style={styles.finalChoiceButton} onPress={() => applyChosenFinalPoint(true)}><Text style={styles.finalChoiceText}>Terminar en la última entrega</Text></Pressable>
          <TextInput value={endAddress} onChangeText={setEndAddress} placeholder="Escribe dirección final" placeholderTextColor="#91A098" style={styles.failureDialogInput} />
          <Pressable style={styles.favoriteSaveLink} onPress={() => openFavoriteDialog('end')}><Text style={styles.favoriteSaveText}>☆ Guardar destino como favorito</Text></Pressable>
          {routeFavorites.map((favorite) => <View key={favorite.id} style={styles.favoriteRow}><Text style={styles.favoriteName}>{favorite.label}</Text><Text style={styles.favoriteAddress} numberOfLines={1}>{favorite.address}</Text><Pressable onPress={() => applyChosenFinalPoint(false, favorite.address)}><Text style={styles.favoriteAction}>Usar</Text></Pressable><Pressable onPress={async () => setRouteFavorites(await deleteRouteFavorite(favorite.id))}><Text style={styles.favoriteDelete}>×</Text></Pressable></View>)}
          <View style={styles.failureDialogActions}>
            <Pressable style={styles.failureDialogSecondary} onPress={() => setFinalPointDialogVisible(false)}><Text style={styles.failureDialogSecondaryText}>Cancelar</Text></Pressable>
            <Pressable style={styles.failureDialogPrimary} onPress={() => applyChosenFinalPoint(false)}><Text style={styles.failureDialogPrimaryText}>{routeStarted ? 'Guardar destino' : 'Usar destino y optimizar'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={addStopPlacementVisible} transparent animationType="fade" onRequestClose={() => setAddStopPlacementVisible(false)}>
      <View style={styles.failureOverlay}>
        <View style={styles.failureDialog}>
          <Text style={styles.failureDialogTitle}>Ubicar nueva parada</Text>
          <Text style={styles.failureDialogText}>La dirección nueva queda más cerca de esta parada:
{suggestedStopAddress}

Para no cambiar los números de tus paquetes, insértala como una subparada. Sugerencia: {suggestedStopNumber}.</Text>
          <TextInput value={selectedStopNumber} onChangeText={setSelectedStopNumber} keyboardType="decimal-pad" placeholder="Ej.: 4.1" placeholderTextColor="#91A098" style={styles.failureDialogInput} />
          <View style={styles.failureDialogActions}>
            <Pressable style={styles.failureDialogSecondary} onPress={() => { setAddStopPlacementVisible(false); setPlacementPreviewAddress(''); }}><Text style={styles.failureDialogSecondaryText}>Cancelar</Text></Pressable>
            <Pressable style={styles.failureDialogPrimary} onPress={() => { const clean = selectedStopNumber.trim(); if (!/^\d+(?:\.\d+)?$/.test(clean) || Number(clean) <= 0 || stops.some((stop) => Number(stop.sequence) === Number(clean))) { setStorageError('Usa un número como 4.1 que todavía no esté ocupado.'); return; } void addStop(clean); }} disabled={!selectedStopNumber.trim()}><Text style={styles.failureDialogPrimaryText}>Insertar parada</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale }, content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116, flexGrow: 1 },
  addressSearchHint: { color: colors.muted, fontSize: 10, paddingVertical: 8 }, addressSuggestion: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }, addressSuggestionIcon: { color: colors.green, fontSize: 16 }, addressSuggestionText: { flex: 1, color: colors.ink, fontSize: 11, lineHeight: 15 },
  favoriteSaveLink: { alignSelf: 'flex-start', paddingVertical: 7 }, favoriteSaveText: { color: colors.green, fontSize: 10, fontWeight: '700' }, favoriteRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 }, favoriteName: { flex: 1, color: colors.ink, fontSize: 11, fontWeight: '600' }, favoriteAddress: { flex: 1, color: colors.muted, fontSize: 9 }, favoriteAction: { color: colors.green, fontSize: 10, fontWeight: '700' }, favoriteDelete: { color: colors.red, fontSize: 19, paddingHorizontal: 4 }, finalChoiceButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF1E8', borderRadius: 10, marginVertical: 6 }, finalChoiceText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  liveRouteScreen: { flex: 1, width: '100%', alignSelf: 'center', backgroundColor: colors.pale }, liveRouteHeader: { minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line }, liveListButton: { minWidth: 82, minHeight: 38, justifyContent: 'center' }, liveListButtonText: { color: colors.green, fontSize: 12, fontWeight: '700' }, liveRouteTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, liveHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 5 }, liveProgress: { minWidth: 42, textAlign: 'right', color: colors.green, fontSize: 13, fontWeight: '800' }, liveBackButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F3EF' }, liveBackButtonText: { color: colors.ink, fontSize: 24, lineHeight: 27 },
  liveStopCard: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 104, backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.line }, liveStopEyebrow: { color: colors.green, fontSize: 9, letterSpacing: 1.1, fontWeight: '800' }, liveStopAddress: { color: colors.ink, fontSize: 14, fontWeight: '700', lineHeight: 19, marginTop: 4 }, liveStopNote: { color: colors.muted, fontSize: 11, marginTop: 4 }, liveNavigateButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', marginTop: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.green, backgroundColor: '#F1F6EF' }, liveNavigateButtonText: { color: colors.green, fontSize: 12, fontWeight: '800' }, liveActionRow: { flexDirection: 'row', gap: 9, marginTop: 10 }, liveActionButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' }, liveFailureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, liveReasonInput: { flex: 1, marginBottom: 0 }, liveSaveFailure: { minHeight: 40, justifyContent: 'center' }, liveFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }, liveRemaining: { color: colors.muted, fontSize: 10 }, liveFinishButton: { paddingVertical: 6, paddingHorizontal: 10 }, liveFinishText: { color: colors.red, fontSize: 10, fontWeight: '700' }, nextStopNotice: { position: 'absolute', zIndex: 5, alignSelf: 'center', top: -43, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: colors.green, shadowColor: '#14271B', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 }, nextStopNoticeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  stopListOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13, 28, 19, 0.35)' }, stopListSheet: { maxHeight: '82%', minHeight: '48%', backgroundColor: colors.pale, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingHorizontal: 16 }, stopListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line }, stopListTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' }, stopListSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 }, stopListClose: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white }, stopListCloseText: { color: colors.ink, fontSize: 24 }, stopListTabs: { flexDirection: 'row', gap: 5, paddingVertical: 10 }, stopListTab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.line }, stopListTabActive: { backgroundColor: '#EAF1E8', borderColor: colors.green }, stopListTabText: { color: colors.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' }, stopListTabTextActive: { color: colors.green }, stopListContent: { paddingBottom: 24 }, stopListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 9, marginBottom: 5, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' }, stopListRowActive: { borderColor: colors.green, backgroundColor: '#F1F6EF' }, stopListRowSelected: { borderWidth: 2, borderColor: '#2878D0', backgroundColor: '#F1F7FF' }, stopSelectionBox: { width: 19, height: 19, borderRadius: 5, borderWidth: 1.5, borderColor: '#91A9BD', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginRight: 8 }, stopSelectionBoxActive: { backgroundColor: '#2878D0', borderColor: '#2878D0' }, stopSelectionCheck: { color: colors.white, fontSize: 13, fontWeight: '900', lineHeight: 16 }, stopListNumber: { width: 30, color: colors.green, fontSize: 12, fontWeight: '800' }, stopListCopy: { flex: 1, paddingRight: 7 }, stopListAddress: { color: colors.ink, fontSize: 11, fontWeight: '600', lineHeight: 15 }, stopListNote: { color: colors.muted, fontSize: 9, marginTop: 2 }, stopListStatusPending: { color: '#94602B', fontSize: 9, fontWeight: '700' }, stopListStatusDone: { color: colors.green, fontSize: 9, fontWeight: '700' }, stopListStatusFailed: { color: colors.red, fontSize: 9, fontWeight: '700' }, stopListNavigateFloat: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 10, borderRadius: 14, backgroundColor: colors.green, elevation: 6, shadowColor: '#14271B', shadowOpacity: 0.2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } }, stopListNavigateFloatText: { color: colors.white, fontSize: 12, fontWeight: '800' }, visitedToggle: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 9, borderRadius: 11, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, visitedToggleText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 }, backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }, title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  workflow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 18, paddingHorizontal: 13, paddingVertical: 14, borderRadius: 17, backgroundColor: '#E7EDE3' }, workflowStep: { flex: 1, alignItems: 'center', gap: 6 }, workflowNumber: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: '#D3DDD0' }, workflowNumberActive: { backgroundColor: colors.green, borderColor: colors.green }, workflowNumberText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, workflowNumberTextActive: { color: colors.white }, workflowLabel: { color: colors.ink, fontSize: 9, fontWeight: '600', textAlign: 'center' }, workflowConnector: { width: 18, height: 1, marginBottom: 16, backgroundColor: '#B9CBB7' },
  inputCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, marginTop: 24 }, inputLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }, input: { minHeight: 48, color: colors.ink, fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 14 },
  addButton: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 14, marginTop: 16 }, disabledButton: { opacity: 0.55 }, addButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  importButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, marginTop: 9 }, importButtonText: { color: colors.green, fontSize: 12, fontWeight: '700' }, csvHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 7, textAlign: 'center' },
  previewCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 15, marginTop: 12 }, previewTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, previewText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 }, previewAddress: { color: colors.ink, fontSize: 11, lineHeight: 17, marginTop: 5 }, previewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 }, cancelImportButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 }, cancelImportText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, confirmImportButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.green, borderRadius: 11 }, confirmImportText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  accountNotice: { backgroundColor: '#E7EDE3', borderRadius: 14, padding: 14, marginTop: 16 }, accountText: { color: colors.ink, fontSize: 12, lineHeight: 18 }, accountLink: { color: colors.green, fontWeight: '700', marginTop: 8 },
  navigationCard: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 14 }, navigationTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' }, navigationHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, providerRow: { flexDirection: 'row', gap: 6, marginTop: 10 }, providerButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.line }, providerSelected: { backgroundColor: '#EAF1E8', borderColor: '#B9CBB7' }, providerText: { color: colors.muted, fontSize: 9, fontWeight: '600', textAlign: 'center' }, providerTextSelected: { color: colors.green, fontWeight: '700' }, startButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 11, marginTop: 10 }, startButtonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  finishRouteSection: { alignItems: 'center', marginTop: 15, marginBottom: 16, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, finishRouteHint: { color: colors.muted, fontSize: 11, marginBottom: 9 }, finishRouteButton: { width: '100%', minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#D8A69E', backgroundColor: '#FFF9F7' }, finishRouteButtonText: { color: colors.red, fontSize: 12, fontWeight: '700' }, finishedHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 9, textAlign: 'center' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 25, marginBottom: 10 }, listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, listHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 12 }, listHeading: { color: colors.ink, fontSize: 15, fontWeight: '700' }, stopCount: { color: colors.green, fontWeight: '700' }, historyLink: { color: colors.green, fontSize: 12, fontWeight: '700' }, historyLinkDisabled: { color: colors.muted }, helper: { color: colors.muted, padding: 12 }, routeEstimate: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -4, marginBottom: 10 }, optimizeRouteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.green, marginBottom: 10 }, optimizeRouteText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  stopTabs: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: '#E7EDE3', marginBottom: 11 }, stopTab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, stopTabActive: { backgroundColor: colors.white }, stopTabText: { color: colors.muted, fontSize: 11, fontWeight: '600' }, stopTabTextActive: { color: colors.green, fontWeight: '700' }, emptyListCard: { padding: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 15, alignItems: 'center' }, emptyListTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' }, emptyListText: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  emptyCard: { minHeight: 185, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, marginTop: 3, backgroundColor: colors.white, borderRadius: 22, borderWidth: 1, borderColor: colors.line }, pin: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center', marginBottom: 17 }, pinText: { color: colors.green, fontSize: 30 }, emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' }, emptyDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  stopCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 8 }, stopCardDelivered: { backgroundColor: '#F1F8F0', borderColor: '#3E8B55', borderWidth: 2 }, stopCardFailed: { backgroundColor: '#FFF4F2', borderColor: '#B84035', borderWidth: 2 }, stopCardSelected: { borderColor: '#2878D0', borderWidth: 2 }, stopTop: { flexDirection: 'row', alignItems: 'center' }, stopIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' }, stopNumber: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center' }, stopNumberText: { color: colors.green, fontSize: 12, fontWeight: '700' }, addressCopy: { flex: 1, marginLeft: 11 }, stopAddress: { color: colors.ink, fontSize: 13 }, customerName: { color: colors.ink, fontSize: 10, fontWeight: '600', marginTop: 4 }, customerCount: { color: colors.green, fontSize: 10, fontWeight: '700', marginTop: 4 }, removeStop: { color: colors.muted, fontSize: 23, paddingHorizontal: 5 },
  navigateStopButton: { alignSelf: 'flex-start', marginLeft: 41, marginTop: 9, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#EAF1E8' }, navigateStopButtonText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  noteEditor: { marginLeft: 41, marginTop: 12, padding: 11, backgroundColor: '#F7F9F5', borderRadius: 11 }, packageTip: { color: colors.muted, fontSize: 10, lineHeight: 15 }, noteInput: { minHeight: 40, color: colors.ink, fontSize: 12, borderBottomWidth: 1, borderBottomColor: colors.line, marginTop: 4 }, noteSaveButton: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAF1E8' }, noteSaveText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  phoneSection: { marginLeft: 41, marginTop: 10 }, phoneInput: { minHeight: 42, color: colors.ink, fontSize: 12, borderBottomWidth: 1, borderBottomColor: colors.line }, phoneActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 7 }, phoneNumber: { color: colors.ink, fontSize: 11, fontWeight: '600', marginRight: 3 }, phoneSaved: { color: colors.green, fontSize: 10, fontWeight: '700' }, contactButton: { backgroundColor: '#EAF1E8', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 }, contactButtonText: { color: colors.green, fontSize: 10, fontWeight: '700' }, whatsappButton: { backgroundColor: '#E1F5E8' }, phoneEdit: { color: colors.muted, fontSize: 10, fontWeight: '600', paddingHorizontal: 4 }, phoneCancel: { padding: 8 }, phoneCancelText: { color: colors.muted, fontSize: 10 }, addPhoneButton: { alignSelf: 'flex-start', paddingVertical: 6 }, addPhoneText: { color: colors.green, fontSize: 10, fontWeight: '600' },
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
  failureOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22, backgroundColor: 'rgba(13, 28, 19, 0.5)' },
  failureDialog: { width: '100%', maxWidth: 390, backgroundColor: colors.white, borderRadius: 20, padding: 20, elevation: 16 },
  failureDialogTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  failureDialogText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  failureDialogInput: { minHeight: 90, maxHeight: 140, textAlignVertical: 'top', color: colors.ink, fontSize: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 11, marginTop: 14 },
  failureDialogActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  failureDialogSecondary: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.pale },
  failureDialogSecondaryText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  failureDialogPrimary: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.green },
  failureDialogPrimaryText: { color: colors.white, fontSize: 11, fontWeight: '700' },
});
