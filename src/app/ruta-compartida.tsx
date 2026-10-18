import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadSharedRouteLink, type SharedRouteSnapshot } from '@/lib/route-repository';
import { ThemeLayer } from '@/components/theme-layer';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', red: '#A14337' };

type SharedStop = { address: string; packageNumber: string; customerName: string; customerPhone: string; status: 'pending' | 'delivered' | 'failed' };
type SharedRoute = { name: string; stops: SharedStop[] };

function readSharedRoute(raw: string | string[] | undefined): SharedRoute | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > 60_000) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SharedRoute>;
    if (typeof parsed.name !== 'string' || !Array.isArray(parsed.stops) || parsed.stops.length === 0 || parsed.stops.length > 100) return null;
    const stops = parsed.stops.flatMap((stop, index): SharedStop[] => {
      if (!stop || typeof stop.address !== 'string' || !stop.address.trim() || stop.address.length > 500) return [];
      const status = stop.status === 'delivered' || stop.status === 'failed' ? stop.status : 'pending';
      const packageNumber = typeof stop.packageNumber === 'string' && /^\d+(?:\.\d+)?$/.test(stop.packageNumber)
        ? stop.packageNumber.slice(0, 12)
        : String(index + 1);
      const customerName = typeof stop.customerName === 'string' ? stop.customerName.slice(0, 200) : '';
      const customerPhone = typeof stop.customerPhone === 'string' ? stop.customerPhone.slice(0, 30) : '';
      return [{ address: stop.address, packageNumber, customerName, customerPhone, status }];
    });
    if (stops.length !== parsed.stops.length) return null;
    return { name: parsed.name.slice(0, 60), stops };
  } catch {
    return null;
  }
}

export default function SharedRouteScreen() {
  const router = useRouter();
  const { data, share } = useLocalSearchParams<{ data?: string | string[]; share?: string | string[] }>();
  const inlineRoute = useMemo(() => readSharedRoute(data), [data]);
  const [cloudRoute, setCloudRoute] = useState<SharedRouteSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const shareId = Array.isArray(share) ? share[0] : share;

  useEffect(() => {
    if (inlineRoute || !shareId) return;
    let cancelled = false;
    setIsLoading(true);
    void loadSharedRouteLink(shareId)
      .then((loaded) => { if (!cancelled) setCloudRoute(loaded); })
      .catch(() => { if (!cancelled) setCloudRoute(null); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [inlineRoute, shareId]);

  const route = inlineRoute ?? cloudRoute;

  if (!route) {
    return (
      <ThemeLayer><SafeAreaView style={styles.safeArea}>
        <View style={styles.errorCard}>
          <Text style={styles.title}>{isLoading ? 'Abriendo ruta…' : 'No se pudo abrir la ruta'}</Text>
          <Text style={styles.subtitle}>{isLoading ? 'Cargando las paradas compartidas.' : 'El enlace venció o ya no contiene una ruta válida.'}</Text>
          <Pressable style={styles.backButton} onPress={() => router.replace('/ruta')}><Text style={styles.backButtonText}>Ir a Connect</Text></Pressable>
        </View>
      </SafeAreaView></ThemeLayer>
    );
  }

  const pending = route.stops.filter((stop) => stop.status === 'pending').length;
  const delivered = route.stops.filter((stop) => stop.status === 'delivered').length;
  const failed = route.stops.filter((stop) => stop.status === 'failed').length;

  return (
    <ThemeLayer><SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.replace('/ruta')}><Text style={styles.backLink}>‹  Connect</Text></Pressable>
        <Text style={styles.eyebrow}>RUTA COMPARTIDA</Text>
        <Text style={styles.title}>{route.name}</Text>
        <Text style={styles.subtitle}>{route.stops.length} paradas · {pending} por visitar · {delivered} entregadas · {failed} fallidas</Text>
        <View style={styles.list}>
          {route.stops.map((stop, index) => (
            <View key={`${index}-${stop.address}`} style={[styles.stopCard, stop.status === 'delivered' && styles.deliveredCard, stop.status === 'failed' && styles.failedCard]}>
              <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{stop.packageNumber}</Text></View>
              <View style={styles.stopCopy}>
                <Text style={styles.address}>{stop.address}</Text>
                {!!stop.customerName && <Text style={styles.customerName}>{stop.customerName}</Text>}
                {!!stop.customerPhone && <Pressable onPress={() => void Linking.openURL(`tel:${stop.customerPhone.replace(/[^+\d]/g, '')}`)}><Text style={styles.customerPhone}>☎ {stop.customerPhone}</Text></Pressable>}
                <Text style={[styles.status, stop.status === 'delivered' && styles.deliveredText, stop.status === 'failed' && styles.failedText]}>
                  {stop.status === 'delivered' ? 'Entregada' : stop.status === 'failed' ? 'Fallida' : 'Por visitar'}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.footer}>Vista compartida · La ruta original no se modifica.</Text>
      </ScrollView>
    </SafeAreaView></ThemeLayer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 20, paddingBottom: 40 },
  backLink: { color: colors.green, fontSize: 13, fontWeight: '700', paddingVertical: 8 },
  eyebrow: { color: colors.green, fontSize: 10, letterSpacing: 1.2, fontWeight: '800', marginTop: 22 },
  title: { color: colors.ink, fontSize: 23, lineHeight: 29, fontWeight: '800', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6 },
  list: { marginTop: 18 },
  stopCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
  deliveredCard: { backgroundColor: '#F1F8F0', borderColor: '#3E8B55', borderWidth: 2 },
  failedCard: { backgroundColor: '#FFF4F2', borderColor: '#B84035', borderWidth: 2 },
  stopNumber: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#EAF1E8', marginRight: 11 },
  stopNumberText: { color: colors.green, fontSize: 11, fontWeight: '800' },
  stopCopy: { flex: 1 },
  address: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  customerName: { color: colors.ink, fontSize: 11, fontWeight: '600', marginTop: 4 },
  customerPhone: { color: colors.green, fontSize: 11, fontWeight: '700', marginTop: 4 },
  status: { color: '#94602B', fontSize: 10, fontWeight: '700', marginTop: 4 },
  deliveredText: { color: colors.green },
  failedText: { color: colors.red },
  footer: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 14 },
  errorCard: { flex: 1, justifyContent: 'center', padding: 24 },
  backButton: { alignSelf: 'flex-start', backgroundColor: colors.green, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 11, marginTop: 18 },
  backButtonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
});
