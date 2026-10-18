import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, signInWithCredential, type User } from 'firebase/auth';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isRunningInExpoGo } from 'expo';
import * as WebBrowser from 'expo-web-browser';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { registerWithEmail, signInWithEmail, signOutAccount } from '@/lib/auth';
import { useAppPreferences, type MapPreference, type ThemePreference } from '@/lib/app-preferences';
import { ThemeLayer } from '@/components/theme-layer';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', error: '#A14337' };
type AccountMode = 'login' | 'register';
WebBrowser.maybeCompleteAuthSession();
const mapChoices: { id: MapPreference; title: string; detail: string }[] = [
  { id: 'inside', title: 'Mapa integrado', detail: 'Ver la ruta y sus paradas dentro de Connect.' },
  { id: 'google', title: 'Google Maps', detail: 'Abrir cada parada en Google Maps.' },
  { id: 'waze', title: 'Waze', detail: 'Abrir cada parada en Waze.' },
];
const themeChoices: { id: ThemePreference; title: string }[] = [
  { id: 'system', title: 'Automático' },
  { id: 'light', title: 'Claro' },
  { id: 'dark', title: 'Oscuro' },
];

function getFriendlyError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/email-already-in-use') return 'Ese correo ya tiene una cuenta.';
  if (code === 'auth/invalid-email') return 'Revisa el formato del correo.';
  if (code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'El correo o la contraseña no son correctos.';
  if (code === 'auth/too-many-requests') return 'Hubo demasiados intentos. Espera un momento y vuelve a probar.';
  if (code === 'auth/network-request-failed') return 'No se pudo conectar. Revisa tu conexión a internet.';
  if (code === 'auth/operation-not-allowed') return 'Activa el proveedor de Google en Firebase Authentication.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

export default function AccountScreen() {
  const router = useRouter();
  const googleIds = {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  };
  const activeGoogleClientId = Platform.select({ android: googleIds.androidClientId, ios: googleIds.iosClientId, default: googleIds.webClientId });
  const googleConfigured = Boolean(activeGoogleClientId);
  const [googleRequest, googleResponse, promptGoogle] = useIdTokenAuthRequest({
    ...googleIds,
    webClientId: googleIds.webClientId || 'google-web-client-not-configured',
    androidClientId: googleIds.androidClientId || 'google-android-client-not-configured',
    iosClientId: googleIds.iosClientId || 'google-ios-client-not-configured',
    selectAccount: true,
    language: 'es',
  }, { scheme: 'connect', path: 'auth' });
  const systemScheme = useColorScheme();
  const { theme, map, setTheme, setMap } = useAppPreferences();
  const dark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const preferenceColors = dark
    ? { card: '#1C2921', text: '#E7EFE9', muted: '#A8B8AD', line: '#34453A', selected: '#2A4534', accent: '#A6D2B1' }
    : { card: colors.white, text: colors.ink, muted: colors.muted, line: colors.line, selected: '#EAF1E8', accent: colors.green };
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [mode, setMode] = useState<AccountMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (nextUser?.emailVerified) router.replace('/');
    });
  }, [router]);

  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      if (googleResponse?.type === 'error') setErrorMessage('Google no pudo iniciar sesión. Revisa los clientes OAuth configurados.');
      return;
    }
    const idToken = googleResponse.authentication?.idToken ?? googleResponse.params?.id_token;
    if (!auth || !idToken) {
      setErrorMessage('Google no entregó un token de acceso. Revisa la configuración OAuth.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    void signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
      .then(({ user: googleUser }) => {
        setUser(googleUser);
        if (googleUser.emailVerified) router.replace('/');
        else setMessage('Sesión iniciada. Verifica tu correo antes de empezar la ruta.');
      })
      .catch((error: unknown) => setErrorMessage(getFriendlyError(error)))
      .finally(() => setBusy(false));
  }, [googleResponse, router]);

  async function signInWithGoogle() {
    setMessage('');
    setErrorMessage('');
    if (!googleConfigured) {
      setErrorMessage('Faltan los clientes OAuth de Google en el archivo .env.');
      return;
    }
    if (!auth) {
      setErrorMessage('Conecta Firebase antes de iniciar sesión con Google.');
      return;
    }
    if (!googleRequest) {
      setErrorMessage('Google todavía está preparando el inicio de sesión. Inténtalo en unos segundos.');
      return;
    }
    if (isRunningInExpoGo()) {
      setErrorMessage('Google requiere una compilación de desarrollo de Connect; Expo Go no puede completar el regreso desde Google.');
      return;
    }
    setBusy(true);
    try {
      await promptGoogle();
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount() {
    setMessage('');
    setErrorMessage('');
    if (!email.trim() || !password) {
      setErrorMessage('Escribe tu correo y tu contraseña.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerWithEmail(email, password);
        setMessage('Cuenta creada. Revisa tu correo para verificarla.');
      } else {
        const signedInUser = await signInWithEmail(email, password);
        if (signedInUser.emailVerified) {
          setMessage('Sesión iniciada.');
          router.replace('/');
        } else setMessage('Sesión iniciada. Verifica tu correo antes de empezar la ruta.');
      }
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshVerification() {
    if (!user || !auth) return;
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    try {
      await reload(user);
      setUser(auth.currentUser);
      if (auth.currentUser?.emailVerified) {
        setMessage('Correo verificado.');
        router.replace('/');
      } else setMessage('Aún no aparece como verificado. Revisa tu bandeja de entrada.');
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!user) return;
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    try {
      await sendEmailVerification(user);
      setMessage('Enviamos otro correo de verificación.');
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function logOut() {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    try {
      await signOutAccount();
      setMessage('Sesión cerrada.');
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemeLayer><SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image source={require('../../assets/images/icon.png')} style={styles.brandLogo} contentFit="contain" />
          <View><Text style={styles.brandName}>Connect</Text><Text style={styles.brandCaption}>RUTAS MÁS SIMPLES</Text></View>
        </View>
        <Text style={styles.eyebrow}>TU ESPACIO</Text>
        <Text style={styles.title}>{user ? 'Cuenta' : 'Inicia tu jornada'}</Text>
        <Text style={styles.subtitle}>{user ? 'Accede a tus rutas y entregas desde tu cuenta.' : 'Inicia sesión o regístrate para organizar tus entregas.'}</Text>

        {!isFirebaseConfigured ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conecta tu Firebase</Text>
            <Text style={styles.bodyText}>La app ya tiene preparado el acceso a Firebase. Falta crear un proyecto nuevo, habilitar el inicio de sesión por correo y agregar la configuración de la app en el archivo .env.</Text>
            <Text style={styles.hint}>Consulta docs/FIREBASE_SETUP.md para ver los pasos. No compartas contraseñas ni claves privadas.</Text>
          </View>
        ) : user ? (
          <View style={styles.card}>
            <View style={styles.userMark}><Text style={styles.userMarkText}>{user.email?.[0]?.toUpperCase() ?? 'C'}</Text></View>
            <Text style={styles.cardTitle}>Sesión iniciada</Text>
            <Text style={styles.email}>{user.email}</Text>
            <View style={[styles.verification, user.emailVerified && styles.verified]}>
              <Text style={[styles.verificationText, user.emailVerified && styles.verifiedText]}>
                {user.emailVerified ? 'Correo verificado' : 'Correo pendiente de verificación'}
              </Text>
            </View>
            {!user.emailVerified && (
              <View style={styles.buttonRow}>
                <Pressable style={styles.secondaryButton} onPress={resendVerification} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Reenviar correo</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={refreshVerification} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Ya lo verifiqué</Text>
                </Pressable>
              </View>
            )}
            <Pressable style={styles.outlineButton} onPress={logOut} disabled={busy}>
              <Text style={styles.outlineButtonText}>{busy ? 'Un momento…' : 'Cerrar sesión'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.modeRow}>
              <Pressable style={[styles.modeButton, mode === 'login' && styles.modeSelected]} onPress={() => { setMode('login'); setMessage(''); setErrorMessage(''); }}>
                <Text style={[styles.modeText, mode === 'login' && styles.modeTextSelected]}>Iniciar sesión</Text>
              </Pressable>
              <Pressable style={[styles.modeButton, mode === 'register' && styles.modeSelected]} onPress={() => { setMode('register'); setMessage(''); setErrorMessage(''); }}>
                <Text style={[styles.modeText, mode === 'register' && styles.modeTextSelected]}>Crear cuenta</Text>
              </Pressable>
            </View>
            <Text style={styles.inputLabel}>CORREO ELECTRÓNICO</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="tu@correo.com"
              placeholderTextColor="#91A098"
              style={styles.input}
              value={email}
            />
            <Text style={styles.inputLabel}>CONTRASEÑA</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete={mode === 'register' ? 'new-password' : 'password'}
              onChangeText={setPassword}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor="#91A098"
              secureTextEntry
              style={styles.input}
              value={password}
            />
            <Pressable style={[styles.primaryButton, busy && styles.disabledButton]} onPress={submitAccount} disabled={busy}>
              <Text style={styles.primaryButtonText}>{busy ? 'Un momento…' : mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}</Text>
            </Pressable>
            <View style={styles.loginDivider}><View style={styles.loginDividerLine} /><Text style={styles.loginDividerText}>O CONTINÚA CON</Text><View style={styles.loginDividerLine} /></View>
            <Pressable style={[styles.googleButton, (busy || !googleRequest) && styles.disabledButton]} onPress={() => void signInWithGoogle()} disabled={busy || !googleRequest}>
              <Text style={styles.googleMark}>G</Text><Text style={styles.googleButtonText}>{busy ? 'Un momento…' : !googleRequest ? 'Preparando Google…' : 'Continuar con Google'}</Text>
            </Pressable>
            {mode === 'register' && <Text style={styles.hint}>Te enviaremos un correo para confirmar tu dirección.</Text>}
          </View>
        )}

        {!!message && <Text style={styles.message}>{message}</Text>}
        {!!errorMessage && <Text style={styles.errorMessage}>{errorMessage}</Text>}
        <Link href="/planes" asChild><Pressable style={styles.plansButton}><Text style={styles.plansIcon}>✦</Text><View style={styles.plansCopy}><Text style={styles.plansTitle}>Planes y suscripción</Text><Text style={styles.plansCaption}>Consulta Gratis y Connect Pro</Text></View><Text style={styles.plansArrow}>›</Text></Pressable></Link>
        {user && <View style={[styles.preferencesCard, { backgroundColor: preferenceColors.card, borderColor: preferenceColors.line }]}>
          <Text style={[styles.preferencesTitle, { color: preferenceColors.text }]}>Configuración</Text>
          <Text style={[styles.preferencesCaption, { color: preferenceColors.muted }]}>Ajusta Connect desde esta misma sección.</Text>
          <Text style={[styles.preferenceLabel, { color: preferenceColors.muted }]}>MAPA PARA NAVEGAR</Text>
          {mapChoices.map((choice) => <Pressable key={choice.id} onPress={() => void setMap(choice.id)} style={[styles.preferenceOption, map === choice.id && { backgroundColor: preferenceColors.selected }]}>
            <View style={[styles.preferenceRadio, { borderColor: preferenceColors.accent }]}>{map === choice.id && <View style={[styles.preferenceRadioDot, { backgroundColor: preferenceColors.accent }]} />}</View>
            <View style={styles.preferenceCopy}><Text style={[styles.preferenceOptionTitle, { color: preferenceColors.text }]}>{choice.title}</Text><Text style={[styles.preferenceDetail, { color: preferenceColors.muted }]}>{choice.detail}</Text></View>
          </Pressable>)}
          <Text style={[styles.preferenceLabel, { color: preferenceColors.muted }]}>TEMA DE LA APP</Text>
          <View style={[styles.themeRow, { backgroundColor: dark ? '#111A15' : colors.pale }]}>{themeChoices.map((choice) => <Pressable key={choice.id} onPress={() => void setTheme(choice.id)} style={[styles.themeChoice, theme === choice.id && { backgroundColor: preferenceColors.selected }]}>
            <Text style={[styles.themeChoiceText, { color: theme === choice.id ? preferenceColors.text : preferenceColors.muted }]}>{choice.title}</Text>
          </Pressable>)}</View>
        </View>}
        <Text style={styles.privacyNote}>Tus rutas en la nube estarán asociadas a tu cuenta. Usa una contraseña distinta de la de otros servicios.</Text>
      </ScrollView>
    </SafeAreaView></ThemeLayer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116, flexGrow: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 24 },
  brandLogo: { width: 48, height: 48, borderRadius: 14, marginRight: 12 },
  brandName: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  brandCaption: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 22 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  card: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 18 },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 3 },
  bodyText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 12 },
  userMark: { width: 48, height: 48, borderRadius: 17, backgroundColor: '#EAF1E8', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  userMarkText: { color: colors.green, fontSize: 20, fontWeight: '700' },
  email: { color: colors.muted, fontSize: 13, marginTop: 8 },
  verification: { alignSelf: 'flex-start', backgroundColor: '#F8EFE3', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, marginTop: 14 },
  verified: { backgroundColor: '#EAF1E8' },
  verificationText: { color: '#94602B', fontSize: 11, fontWeight: '600' },
  verifiedText: { color: colors.green },
  modeRow: { flexDirection: 'row', backgroundColor: colors.pale, padding: 4, borderRadius: 13, marginBottom: 21 },
  modeButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  modeSelected: { backgroundColor: colors.white },
  modeText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  modeTextSelected: { color: colors.ink },
  inputLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginTop: 12 },
  input: { minHeight: 46, color: colors.ink, fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 7 },
  primaryButton: { minHeight: 49, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 14, marginTop: 19 },
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  loginDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 17 },
  loginDividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  loginDividerText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  googleButton: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white, marginTop: 12 },
  googleMark: { color: '#4285F4', fontSize: 17, fontWeight: '800' },
  googleButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  outlineButton: { minHeight: 47, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 14, marginTop: 18 },
  outlineButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  secondaryButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 7 },
  secondaryButtonText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 13 },
  privacyNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 20, textAlign: 'center' },
  plansButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 15, padding: 13, marginTop: 18 },
  plansIcon: { color: colors.green, fontSize: 22, marginHorizontal: 8 },
  plansCopy: { flex: 1, marginLeft: 8 },
  plansTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  plansCaption: { color: colors.muted, fontSize: 10, marginTop: 4 },
  plansArrow: { color: colors.muted, fontSize: 23, marginHorizontal: 5 },
  preferencesCard: { borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 18 },
  preferencesTitle: { fontSize: 16, fontWeight: '700' },
  preferencesCaption: { fontSize: 11, lineHeight: 16, marginTop: 4, marginBottom: 12 },
  preferenceLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginTop: 9, marginBottom: 5 },
  preferenceOption: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 9 },
  preferenceRadio: { width: 18, height: 18, borderWidth: 2, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  preferenceRadioDot: { width: 8, height: 8, borderRadius: 4 },
  preferenceCopy: { flex: 1 },
  preferenceOptionTitle: { fontSize: 12, fontWeight: '700' },
  preferenceDetail: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  themeRow: { flexDirection: 'row', padding: 4, borderRadius: 12, marginTop: 3 },
  themeChoice: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  themeChoiceText: { fontSize: 10, fontWeight: '600' },
  message: { color: colors.green, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  errorMessage: { color: colors.error, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  disabledButton: { opacity: 0.6 },
});
