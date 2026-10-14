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
export const DEFAULT_ROUTE_NAME = 'Ruta del día';

export type LocalRouteHistory = {
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

function routeStorageKey(date = getLocalRouteDate()) {
  return `${ROUTE_STORAGE_PREFIX}${date}`;
}

function routeNameStorageKey(date = getLocalRouteDate()) {
  return `${ROUTE_NAME_STORAGE_PREFIX}${date}`;
}

function routeTimingStorageKey(date = getLocalRouteDate()) {
  return `${ROUTE_TIMING_STORAGE_PREFIX}${date}`;
}

export async function loadLocalRouteTiming(date = getLocalRouteDate()): Promise<LocalRouteTiming> {
  try {
    const raw = await AsyncStorage.getItem(routeTimingStorageKey(date));
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

export async function saveLocalRouteStartedAt(startedAt: number, date = getLocalRouteDate()): Promise<number> {
  const current = await loadLocalRouteTiming(date);
  const initial = current.startedAt ?? startedAt;
  await AsyncStorage.setItem(routeTimingStorageKey(date), JSON.stringify({ startedAt: initial, completedAt: current.completedAt }));
  return initial;
}

export async function finishLocalRoute(completedAt = Date.now(), date = getLocalRouteDate()): Promise<LocalRouteTiming> {
  const current = await loadLocalRouteTiming(date);
  const timing = { startedAt: current.startedAt, completedAt };
  await AsyncStorage.setItem(routeTimingStorageKey(date), JSON.stringify(timing));
  return timing;
}

export async function deleteLocalRoute(date: string): Promise<void> {
  await AsyncStorage.multiRemove([routeStorageKey(date), routeNameStorageKey(date), routeTimingStorageKey(date)]);
}

export async function loadLocalRouteName(date = getLocalRouteDate()): Promise<string> {
  return (await AsyncStorage.getItem(routeNameStorageKey(date)))?.trim() || DEFAULT_ROUTE_NAME;
}

export async function saveLocalRouteName(name: string, date = getLocalRouteDate()): Promise<void> {
  const cleanName = name.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
  await AsyncStorage.setItem(routeNameStorageKey(date), cleanName);
}

export async function loadStops(): Promise<Stop[]> {
  const key = routeStorageKey();
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

export async function saveStops(stops: Stop[]): Promise<void> {
  await AsyncStorage.setItem(routeStorageKey(), JSON.stringify(stops));
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
      const date = key.slice(ROUTE_STORAGE_PREFIX.length);
      const timing = await loadLocalRouteTiming(date);
      history.push({ date, name: await loadLocalRouteName(date), stops, ...timing });
    } catch {
      // Ignore malformed local history entries and keep the rest available.
    }
  }
  return history;
}
