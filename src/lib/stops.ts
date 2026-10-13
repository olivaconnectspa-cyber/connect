import AsyncStorage from '@react-native-async-storage/async-storage';

export type Stop = {
  id: string;
  address: string;
  createdAt: string;
  status?: 'pending' | 'delivered' | 'failed';
  failureReason?: string | null;
};

const STOPS_STORAGE_KEY = '@oliva-connect/stops/v1';

export async function loadStops(): Promise<Stop[]> {
  const savedStops = await AsyncStorage.getItem(STOPS_STORAGE_KEY);
  if (!savedStops) return [];

  try {
    const parsedStops: unknown = JSON.parse(savedStops);
    if (!Array.isArray(parsedStops)) return [];

    return parsedStops.filter(
      (stop): stop is Stop =>
        typeof stop === 'object' &&
        stop !== null &&
        'id' in stop && typeof stop.id === 'string' &&
        'address' in stop && typeof stop.address === 'string' &&
        'createdAt' in stop && typeof stop.createdAt === 'string',
    );
  } catch {
    return [];
  }
}

export async function saveStops(stops: Stop[]): Promise<void> {
  await AsyncStorage.setItem(STOPS_STORAGE_KEY, JSON.stringify(stops));
}
