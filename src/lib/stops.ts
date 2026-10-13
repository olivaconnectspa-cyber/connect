import AsyncStorage from '@react-native-async-storage/async-storage';

export type Stop = {
  id: string;
  address: string;
  createdAt: string;
  status?: 'pending' | 'delivered' | 'failed';
  failureReason?: string | null;
};

const STOPS_STORAGE_KEY = '@oliva-connect/stops/v1';
const ROUTE_STORAGE_PREFIX = '@connect/routes/';
const ROUTE_NAME_STORAGE_PREFIX = '@connect/route-names/';
export const DEFAULT_ROUTE_NAME = 'Ruta del día';

export type LocalRouteHistory = {
  date: string;
  stops: Stop[];
};

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
      history.push({ date: key.slice(ROUTE_STORAGE_PREFIX.length), stops });
    } catch {
      // Ignore malformed local history entries and keep the rest available.
    }
  }
  return history;
}
