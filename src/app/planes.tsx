import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeLayer } from '@/components/theme-layer';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', orange: '#94602B' };

export default function PlansScreen() {
  return (
    <ThemeLayer><SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/cuenta" asChild><Pressable style={styles.backButton}><Text style={styles.backText}>‹  Cuenta</Text></Pressable></Link>
        <Text style={styles.eyebrow}>CONNECT PRO</Text>
        <Text style={styles.title}>Planes</Text>
        <Text style={styles.subtitle}>Elige el plan que acompañe tus jornadas de reparto.</Text>

        <View style={styles.planCard}>
          <Text style={styles.planName}>Gratis</Text>
          <Text style={styles.planDescription}>Para probar Connect y organizar rutas pequeñas.</Text>
          <Text style={styles.benefit}>• Hasta 10 paradas para optimizar</Text>
          <Text style={styles.benefit}>• Registro de entregas e historial</Text>
          <Text style={styles.current}>Disponible en el prototipo</Text>
        </View>

        <View style={[styles.planCard, styles.proCard]}>
          <Text style={styles.planName}>Connect Pro</Text>
          <Text style={styles.planDescription}>Más capacidad y acceso a información comunitaria.</Text>
          <Text style={styles.benefit}>• Rutas con más de 10 paradas</Text>
          <Text style={styles.benefit}>• Información de estacionamientos y accesos</Text>
          <Text style={styles.benefit}>• Opciones semanal y mensual planificadas</Text>
          <View style={styles.soonBadge}><Text style={styles.soonText}>Suscripciones y pagos aún no conectados</Text></View>
        </View>
        <Text style={styles.disclaimer}>No se realizará ningún cobro desde esta pantalla.</Text>
      </ScrollView>
    </SafeAreaView></ThemeLayer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 25 },
  backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  planCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 18, marginBottom: 12 },
  proCard: { borderColor: '#B9CBB7' },
  planName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  planDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  benefit: { color: colors.ink, fontSize: 12, lineHeight: 20 },
  current: { color: colors.green, fontSize: 10, fontWeight: '700', marginTop: 12 },
  soonBadge: { alignSelf: 'flex-start', backgroundColor: '#F8EFE3', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, marginTop: 12 },
  soonText: { color: colors.orange, fontSize: 10, fontWeight: '700' },
  disclaimer: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 4 },
});
