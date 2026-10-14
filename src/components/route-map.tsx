import * as Location from 'expo-location';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Delivery } from '@/lib/route-repository';

type Coordinate = { latitude: number; longitude: number };
type Props = { stops: Delivery[]; activeStopId?: string | null; routeStarted?: boolean; expanded?: boolean; onSelectStop: (id: string) => void };
const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', red: '#A14337' };
const SANTIAGO_REGION: Region = { latitude: -33.4489, longitude: -70.6693, latitudeDelta: 0.18, longitudeDelta: 0.18 };

export default function RouteMap({ stops, activeStopId, routeStarted = false, expanded = false, onSelectStop }: Props) {
  const mapRef = useRef<MapView>(null);
  const [coordinates, setCoordinates] = useState<Record<string, Coordinate>>({});
  const [search, setSearch] = useState('');
  const [searchPin, setSearchPin] = useState<Coordinate | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(Platform.OS !== 'android');
  const [message, setMessage] = useState('');
  const autoLocated = useRef(false);
  async function geocodeStops(): Promise<Record<string, Coordinate> | null> {
    if (loading) return null;
    setLoading(true);
    setMessage('');
    try {
      if (Platform.OS === 'android') {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setMessage('Para ubicar las direcciones, permite el acceso a ubicación mientras usas la app.');
          return null;
        }
        setHasLocationPermission(true);
      }
      const found: Record<string, Coordinate> = { ...coordinates };
      const unresolved = stops.filter((stop) => !coordinates[stop.id]).slice(0, 10);
      for (const [index, stop] of unresolved.entries()) {
        try {
          const results = await Location.geocodeAsync(`${stop.address}, Santiago, Chile`);
          const result = results[0];
          if (result) found[stop.id] = { latitude: result.latitude, longitude: result.longitude };
        } catch {
          // Keep the stop in the route even when the device geocoder cannot locate it.
        }
        if (index < unresolved.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      setCoordinates(found);
      if (Object.keys(found).length === 0 && stops.length > 0) setMessage('No pudimos ubicar estas direcciones. Revisa que incluyan comuna y número.');
      else setMessage(`Ubicaciones aproximadas: ${Object.keys(found).length} de ${stops.length}.${Object.keys(found).length < stops.length ? ' Toca «Ubicar» para cargar las siguientes.' : ''}`);
      return found;
    } catch {
      setMessage('No se pudieron ubicar las direcciones. Revisa la conexión y los permisos de ubicación.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!routeStarted || autoLocated.current) return;
    autoLocated.current = true;
    void geocodeStops();
  }, [routeStarted]);

  async function searchAddress() {
    if (!search.trim()) return;
    setMessage('Buscando dirección…');
    try {
      if (Platform.OS === 'android' && !hasLocationPermission) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setMessage('Se necesita permiso de ubicación para buscar direcciones en el mapa.');
          return;
        }
        setHasLocationPermission(true);
      }
      const result = (await Location.geocodeAsync(`${search.trim()}, Chile`))[0];
      if (!result) {
        setMessage('No encontramos esa dirección. Prueba con calle, número y comuna.');
        return;
      }
      const coordinate = { latitude: result.latitude, longitude: result.longitude };
      setSearchPin(coordinate);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
      setMessage('Resultado de búsqueda aproximado.');
    } catch {
      setMessage('No se pudo buscar. Revisa los datos de la dirección e inténtalo de nuevo.');
    }
  }

  const orderedCoordinates = useMemo(() => stops.flatMap((stop) => {
    const coordinate = coordinates[stop.id];
    return coordinate ? [coordinate] : [];
  }), [coordinates, stops]);

  useEffect(() => {
    if (orderedCoordinates.length > 1) {
      mapRef.current?.fitToCoordinates(orderedCoordinates, {
        edgePadding: { top: 90, right: 45, bottom: 110, left: 45 },
        animated: true,
      });
    } else if (orderedCoordinates.length === 1) {
      mapRef.current?.animateToRegion({ ...orderedCoordinates[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 350);
    }
  }, [orderedCoordinates]);

  useEffect(() => {
    const coordinate = activeStopId ? coordinates[activeStopId] : undefined;
    if (coordinate) mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.015, longitudeDelta: 0.015 }, 350);
  }, [activeStopId, coordinates]);

  useEffect(() => {
    if (!activeStopId || coordinates[activeStopId]) return;
    const stop = stops.find((item) => item.id === activeStopId);
    if (!stop) return;
    void Location.geocodeAsync(`${stop.address}, Santiago, Chile`).then((results) => {
      const result = results[0];
      if (result) setCoordinates((current) => ({ ...current, [stop.id]: { latitude: result.latitude, longitude: result.longitude } }));
    }).catch(() => undefined);
  }, [activeStopId, coordinates, stops]);

  return (
    <View style={[styles.card, expanded && styles.expandedCard]}>
      {!expanded && <View style={styles.headingRow}>
        <View><Text style={styles.title}>Mapa de la ruta</Text><Text style={styles.caption}>Las ubicaciones pueden ser aproximadas; confirma el domicilio.</Text></View>
        <Pressable onPress={() => void geocodeStops()} disabled={loading} style={styles.locateButton}><Text style={styles.locateText}>{loading ? 'Ubicando…' : 'Ubicar'}</Text></Pressable>
      </View>}
      {!expanded && <View style={styles.searchRow}>
        <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => void searchAddress()} placeholder="Buscar dirección en el mapa" placeholderTextColor="#91A098" returnKeyType="search" style={styles.searchInput} />
        <Pressable onPress={() => void searchAddress()} style={styles.searchButton}><Text style={styles.searchButtonText}>Buscar</Text></Pressable>
      </View>}
      <View style={[styles.mapFrame, expanded && styles.expandedMapFrame]}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={SANTIAGO_REGION}>
          {orderedCoordinates.length > 1 && <Polyline coordinates={orderedCoordinates} strokeColor={colors.green} strokeWidth={3} />}
          {stops.map((stop, index) => {
            const coordinate = coordinates[stop.id];
            if (!coordinate) return null;
            const number = stop.displayNumber ?? String(stop.sequence || index + 1);
            return <Marker key={stop.id} coordinate={coordinate} title={`${number} · ${stop.address}`} description={stop.status === 'delivered' ? 'Entregada' : stop.status === 'failed' ? 'Fallida' : 'Pendiente'} onPress={() => { if (stop.status === 'pending') onSelectStop(stop.id); }}>
              <View style={[styles.numberMarker, stop.status === 'delivered' && styles.doneMarker, stop.status === 'failed' && styles.failedMarker]}><Text style={styles.numberMarkerText}>{number}</Text></View>
            </Marker>;
          })}
          {searchPin && <Marker coordinate={searchPin} title={search.trim()} pinColor="#D88C44" />}
        </MapView>
      </View>
      {!expanded && !!message && <Text style={styles.message}>{message}</Text>}
      {!expanded && <Text style={styles.privacyText}>El mapa usa el geocodificador del teléfono para ubicar las direcciones; el permiso se solicita al tocar «Ubicar».</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 13, marginTop: 12, overflow: 'hidden' },
  expandedCard: { flex: 1, marginTop: 0, padding: 0, borderRadius: 0, borderWidth: 0, backgroundColor: '#E5EAE3' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  caption: { color: colors.muted, fontSize: 9, marginTop: 4 },
  locateButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EAF1E8' },
  locateText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 9 },
  searchInput: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, color: colors.ink, fontSize: 11 },
  searchButton: { paddingHorizontal: 11, paddingVertical: 10, backgroundColor: colors.green, borderRadius: 10 },
  searchButtonText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  mapFrame: { height: 310, overflow: 'hidden', borderRadius: 13, backgroundColor: '#E5EAE3' },
  expandedMapFrame: { flex: 1, height: undefined, borderRadius: 0 },
  numberMarker: { minWidth: 29, height: 29, paddingHorizontal: 5, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white },
  doneMarker: { backgroundColor: '#5B8F67' },
  failedMarker: { backgroundColor: colors.red },
  numberMarkerText: { color: colors.white, fontSize: 9, fontWeight: '700' },
  disabledButton: { opacity: 0.45 },
  message: { color: colors.green, fontSize: 10, lineHeight: 15, marginTop: 8 },
  privacyText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 8 },
});
