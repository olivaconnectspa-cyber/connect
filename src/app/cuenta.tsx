import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { onAuthStateChanged, reload, sendEmailVerification, type User } from 'firebase/auth';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { registerWithEmail, signInWithEmail, signOutAccount } from '@/lib/auth';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', error: '#A14337' };
type AccountMode = 'login' | 'register';

function getFriendlyError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/email-already-in-use') return 'Ese correo ya tiene una cuenta.';
  if (code === 'auth/invalid-email') return 'Revisa el formato del correo.';
  if (code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'El correo o la contraseña no son correctos.';
  if (code === 'auth/too-many-requests') return 'Hubo demasiados intentos. Espera un momento y vuelve a probar.';
  if (code === 'auth/network-request-failed') return 'No se pudo conectar. Revisa tu conexión a internet.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

export default function AccountScreen() {
  const router = useRouter();
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
    <SafeAreaView style={styles.safeArea}>
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
            {mode === 'register' && <Text style={styles.hint}>Te enviaremos un correo para confirmar tu dirección.</Text>}
          </View>
        )}

        {!!message && <Text style={styles.message}>{message}</Text>}
        {!!errorMessage && <Text style={styles.errorMessage}>{errorMessage}</Text>}
        <Link href="/planes" asChild><Pressable style={styles.plansButton}><Text style={styles.plansIcon}>✦</Text><View style={styles.plansCopy}><Text style={styles.plansTitle}>Planes y suscripción</Text><Text style={styles.plansCaption}>Consulta Gratis y Connect Pro</Text></View><Text style={styles.plansArrow}>›</Text></Pressable></Link>
        <Link href="/configuracion" asChild><Pressable style={styles.plansButton}><Text style={styles.plansIcon}>⚙</Text><View style={styles.plansCopy}><Text style={styles.plansTitle}>Configuración</Text><Text style={styles.plansCaption}>Mapa y apariencia de la app</Text></View><Text style={styles.plansArrow}>›</Text></Pressable></Link>
        <Text style={styles.privacyNote}>Tus rutas en la nube estarán asociadas a tu cuenta. Usa una contraseña distinta de la de otros servicios.</Text>
      </ScrollView>
    </SafeAreaView>
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
  message: { color: colors.green, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  errorMessage: { color: colors.error, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  disabledButton: { opacity: 0.6 },
});
