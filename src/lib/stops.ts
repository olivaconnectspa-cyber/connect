import AsyncStorage from '@react-native-async-storage/async-storage';

export type Stop = {
  id: string;
  address: string;
  sequence?: number;
  displayNumber?: string;
  createdAt: string;
  customerCount?: number;
  recordCount?: number;
  note?: string;
  /** @deprecated Used only to read stops saved by the earlier importer. */
  packageCount?: number;
  status?: 'pending' | 'delivered' | 'failed';
  failureReason?: string | null;
};

const STOPS_STORAGE_KEY = '@oliva-connect/stops/v1';
const ROUTE_STORAGE_PREFIX = '@connect/routes/';
const ROUTE_NAME_STORAGE_PREFIX = '@connect/route-names/';
const ROUTE_TIMING_STORAGE_PREFIX = '@connect/route-timing/';
const ACTIVE_ROUTE_STORAGE_PREFIX = '@connect/active-route/';
export const DEFAULT_ROUTE_NAME = 'Ruta del día';

export type LocalRouteHistory = {
  id: string;
  date: string;
  name: string;
  stops: Stop[];
  startedAt: number | null;
  completedAt: number | null;
};

export type LocalRouteTiming = { startedAt: number | null; completedAt: number | null };

export function getLocalRouteDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function routeStorageKey(routeId = getLocalRouteDate()) {
  return `${ROUTE_STORAGE_PREFIX}${routeId}`;
}

function routeNameStorageKey(routeId = getLocalRouteDate()) {
  return `${ROUTE_NAME_STORAGE_PREFIX}${routeId}`;
}

function routeTimingStorageKey(routeId = getLocalRouteDate()) {
  return `${ROUTE_TIMING_STORAGE_PREFIX}${routeId}`;
}

export async function loadLocalRouteId(date = getLocalRouteDate()): Promise<string> {
  return (await AsyncStorage.getItem(`${ACTIVE_ROUTE_STORAGE_PREFIX}${date}`)) ?? date;
}

export async function createLocalTodayRoute(): Promise<string> {
  const date = getLocalRouteDate();
  const routeId = `${date}~${Date.now()}`;
  await AsyncStorage.setItem(`${ACTIVE_ROUTE_STORAGE_PREFIX}${date}`, routeId);
  await AsyncStorage.setItem(routeStorageKey(routeId), JSON.stringify([]));
  await AsyncStorage.setItem(routeNameStorageKey(routeId), DEFAULT_ROUTE_NAME);
  await AsyncStorage.setItem(routeTimingStorageKey(routeId), JSON.stringify({ startedAt: null, completedAt: null }));
  return routeId;
}

export async function loadLocalRouteTiming(routeId = getLocalRouteDate()): Promise<LocalRouteTiming> {
  try {
    const raw = await AsyncStorage.getItem(routeTimingStorageKey(routeId));
    if (!raw) return { startedAt: null, completedAt: null };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return { startedAt: null, completedAt: null };
    const timing = data as Record<string, unknown>;
    return {
      startedAt: typeof timing.startedAt === 'number' ? timing.startedAt : null,
      completedAt: typeof timing.completedAt === 'number' ? timing.completedAt : null,
    };
  } catch {
    return { startedAt: null, completedAt: null };
  }
}

export async function saveLocalRouteStartedAt(startedAt: number, routeId = getLocalRouteDate()): Promise<number> {
  const current = await loadLocalRouteTiming(routeId);
  const initial = current.startedAt ?? startedAt;
  await AsyncStorage.setItem(routeTimingStorageKey(routeId), JSON.stringify({ startedAt: initial, completedAt: current.completedAt }));
  return initial;
}

export async function finishLocalRoute(completedAt = Date.now(), routeId = getLocalRouteDate()): Promise<LocalRouteTiming> {
  const current = await loadLocalRouteTiming(routeId);
  const timing = { startedAt: current.startedAt, completedAt };
  await AsyncStorage.setItem(routeTimingStorageKey(routeId), JSON.stringify(timing));
  return timing;
}

export async function deleteLocalRoute(routeId: string): Promise<void> {
  const date = routeId.slice(0, 10);
  await AsyncStorage.multiRemove([routeStorageKey(routeId), routeNameStorageKey(routeId), routeTimingStorageKey(routeId)]);
  if (await AsyncStorage.getItem(`${ACTIVE_ROUTE_STORAGE_PREFIX}${date}`) === routeId) {
    await AsyncStorage.removeItem(`${ACTIVE_ROUTE_STORAGE_PREFIX}${date}`);
  }
}

export async function loadLocalRouteName(routeId = getLocalRouteDate()): Promise<string> {
  return (await AsyncStorage.getItem(routeNameStorageKey(routeId)))?.trim() || DEFAULT_ROUTE_NAME;
}

export async function saveLocalRouteName(name: string, routeId = getLocalRouteDate()): Promise<void> {
  const cleanName = name.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
  await AsyncStorage.setItem(routeNameStorageKey(routeId), cleanName);
}

export async function loadStops(routeId?: string): Promise<Stop[]> {
  const key = routeStorageKey(routeId ?? await loadLocalRouteId());
  const routeStops = await AsyncStorage.getItem(key);
  const savedStops = routeStops ?? await AsyncStorage.getItem(STOPS_STORAGE_KEY);
  if (!savedStops) return [];

  try {
    const parsedStops: unknown = JSON.parse(savedStops);
    if (!Array.isArray(parsedStops)) return [];
    const validStops = parsedStops.filter(
      (stop): stop is Stop =>
        typeof stop === 'object' &&
        stop !== null &&
        'id' in stop && typeof stop.id === 'string' &&
        'address' in stop && typeof stop.address === 'string' &&
        'createdAt' in stop && typeof stop.createdAt === 'string',
    );
    if (!routeStops && validStops.length > 0) {
      await AsyncStorage.setItem(key, JSON.stringify(validStops));
      await AsyncStorage.removeItem(STOPS_STORAGE_KEY);
    }
    return validStops;
  } catch {
    return [];
  }
}

export async function saveStops(stops: Stop[], routeId?: string): Promise<void> {
  await AsyncStorage.setItem(routeStorageKey(routeId ?? await loadLocalRouteId()), JSON.stringify(stops));
}

export async function loadLocalRouteHistory(): Promise<LocalRouteHistory[]> {
  const keys = (await AsyncStorage.getAllKeys())
    .filter((key) => key.startsWith(ROUTE_STORAGE_PREFIX))
    .sort((left, right) => right.localeCompare(left));
  const entries = await AsyncStorage.multiGet(keys);
  const history: LocalRouteHistory[] = [];

  for (const [key, value] of entries) {
    if (!value) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) continue;
      const stops = parsed.filter(
        (stop): stop is Stop =>
          typeof stop === 'object' && stop !== null &&
          'id' in stop && typeof stop.id === 'string' &&
          'address' in stop && typeof stop.address === 'string' &&
          'createdAt' in stop && typeof stop.createdAt === 'string',
      );
      const id = key.slice(ROUTE_STORAGE_PREFIX.length);
      const date = id.slice(0, 10);
      const timing = await loadLocalRouteTiming(id);
      history.push({ id, date, name: await loadLocalRouteName(id), stops, ...timing });
    } catch {
      // Ignore malformed local history entries and keep the rest available.
    }
  }
  return history;
}
