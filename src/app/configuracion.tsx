import { useColorScheme, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppPreferences, type MapPreference, type ThemePreference } from '@/lib/app-preferences';

const mapChoices: { id: MapPreference; title: string; detail: string }[] = [
  { id: 'inside', title: 'Mapa integrado', detail: 'Ver la ruta y sus paradas dentro de Connect.' },
  { id: 'google', title: 'Google Maps', detail: 'Abrir la navegación de cada parada en Google Maps.' },
  { id: 'waze', title: 'Waze', detail: 'Abrir la navegación de cada parada en Waze.' },
];
const themeChoices: { id: ThemePreference; title: string }[] = [
  { id: 'system', title: 'Automático' },
  { id: 'light', title: 'Claro' },
  { id: 'dark', title: 'Oscuro' },
];

export default function SettingsScreen() {
  const { theme, map, setTheme, setMap } = useAppPreferences();
  const systemScheme = useColorScheme();
  const dark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const colors = dark
    ? { bg: '#111A15', card: '#1C2921', text: '#E7EFE9', muted: '#A8B8AD', line: '#34453A', selected: '#2A4534', accent: '#A6D2B1' }
    : { bg: '#F2F5EF', card: '#FFFFFF', text: '#20352B', muted: '#718078', line: '#E5EAE3', selected: '#EAF1E8', accent: '#315E43' };
  const styles = createStyles(colors);

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PERSONALIZA CONNECT</Text>
      <Text style={styles.title}>Configuración</Text>
      <Text style={styles.intro}>Elige cómo quieres ver la app y qué mapa abrir al iniciar cada ruta.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Mapa para navegar</Text>
        {mapChoices.map((choice) => <Pressable key={choice.id} onPress={() => void setMap(choice.id)} style={[styles.option, map === choice.id && styles.selected]}>
          <View style={styles.radio}>{map === choice.id && <View style={styles.radioDot} />}</View>
          <View style={styles.copy}><Text style={styles.optionTitle}>{choice.title}</Text><Text style={styles.detail}>{choice.detail}</Text></View>
        </Pressable>)}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Apariencia</Text>
        <View style={styles.themes}>{themeChoices.map((choice) => <Pressable key={choice.id} onPress={() => void setTheme(choice.id)} style={[styles.themeButton, theme === choice.id && styles.selected]}>
          <Text style={[styles.themeText, theme === choice.id && styles.activeThemeText]}>{choice.title}</Text>
        </Pressable>)}</View>
        <Text style={styles.detail}>Automático sigue el tema del teléfono. La preferencia se guarda y cambia el tema de navegación; algunas pantallas de Connect aún necesitan adaptar sus colores para verse completamente oscuras.</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(colors: { bg: string; card: string; text: string; muted: string; line: string; selected: string; accent: string }) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg }, content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116 },
    eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 24 }, title: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 8 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
    card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 16, marginBottom: 14 }, sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 12, padding: 10, marginHorizontal: -5 }, selected: { backgroundColor: colors.selected }, radio: { width: 19, height: 19, borderWidth: 2, borderColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 9, height: 9, backgroundColor: colors.accent, borderRadius: 5 }, copy: { flex: 1 }, optionTitle: { color: colors.text, fontSize: 13, fontWeight: '700' }, detail: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
    themes: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 12, padding: 4, marginBottom: 11 }, themeButton: { flex: 1, borderRadius: 9, alignItems: 'center', paddingVertical: 10 }, themeText: { color: colors.muted, fontSize: 11, fontWeight: '600' }, activeThemeText: { color: colors.text, fontWeight: '700' },
  });
}
