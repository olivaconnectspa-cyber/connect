import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db, isFirebaseConfigured, storage } from '@/lib/firebase';
import { normalizeDeliveryAddress } from '@/lib/csv';
import { ThemeLayer } from '@/components/theme-layer';

const colors = { ink: '#20352B', muted: '#718078', green: '#315E43', pale: '#F2F5EF', line: '#E5EAE3', white: '#FFFFFF', orange: '#D88C44' };
const MAX_PHOTO_DISTANCE_METERS = 150;
const MAX_PHOTO_GPS_ACCURACY_METERS = 80;
type CommunityComment = { id: string; text: string; expiresAt: Timestamp };
type ParkingType = 'unknown' | 'street' | 'visitor' | 'private' | 'none';
const parkingOptions: Array<{ value: ParkingType; label: string }> = [
  { value: 'street', label: 'En la calle' },
  { value: 'visitor', label: 'Visitas' },
  { value: 'private', label: 'Privado' },
  { value: 'none', label: 'No hay' },
];
const parkingLabels: Record<ParkingType, string> = { unknown: 'Sin confirmar', street: 'En la calle', visitor: 'Estacionamiento de visitas', private: 'Estacionamiento privado', none: 'Sin estacionamiento' };

function addressKey(value: string) {
  const normalized = normalizeDeliveryAddress(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
  return `${normalized.replace(/[^a-z0-9]+/g, '-').slice(0, 70)}-${(hash >>> 0).toString(36)}`;
}

function distanceInMeters(expected: Location.LocationGeocodedLocation, current: Location.LocationObject) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(current.coords.latitude - expected.latitude);
  const longitudeDelta = radians(current.coords.longitude - expected.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(expected.latitude)) * Math.cos(radians(current.coords.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function AddressCommunityScreen() {
  const { address: routeAddress, fromDelivery, capturePhoto } = useLocalSearchParams<{ address?: string; fromDelivery?: string; capturePhoto?: string }>();
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [photoUri, setPhotoUri] = useState('');
  const [addressId, setAddressId] = useState('');
  const [credibility, setCredibility] = useState(0);
  const [photoLocked, setPhotoLocked] = useState(false);
  const [parkingType, setParkingType] = useState<ParkingType>('unknown');
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const photoSectionY = useRef(0);
  const autoCaptureAddress = useRef('');

  useEffect(() => {
    const deliveryAddress = typeof routeAddress === 'string' ? routeAddress.trim() : '';
    if (!deliveryAddress) return;
    if (fromDelivery === 'true' && capturePhoto === 'true' && autoCaptureAddress.current === deliveryAddress) return;
    if (fromDelivery === 'true' && capturePhoto === 'true') autoCaptureAddress.current = deliveryAddress;
    setAddress(deliveryAddress);
    setPhotoUri('');
    void (async () => {
      try {
        await prepareAddress(deliveryAddress);
        setMessage(fromDelivery === 'true' ? 'Dirección de la entrega lista. El GPS confirmará que sigues cerca antes de enviar la foto.' : 'Dirección lista para consultar o aportar.');
        if (fromDelivery === 'true' && capturePhoto === 'true') {
          await selectPhoto(true);
          setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(photoSectionY.current - 18, 0), animated: true }), 250);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo consultar esta dirección.');
      }
    })();
  // These route params seed the delivery address and open its photo capture once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeAddress, fromDelivery, capturePhoto]);

  async function prepareAddress(addressOverride?: string) {
    const cleanAddress = (addressOverride ?? address).trim().slice(0, 500);
    if (!cleanAddress) throw new Error('Escribe una dirección primero.');
    if (!db) throw new Error('Conecta Firebase para guardar los aportes comunitarios.');
    const id = addressKey(cleanAddress);
    const addressRef = doc(db, 'communityAddresses', id);
    const snapshot = await getDoc(addressRef);
    if (!snapshot.exists()) {
      await setDoc(addressRef, {
        canonicalAddress: normalizeDeliveryAddress(cleanAddress),
        address: cleanAddress,
        credibilityPercent: 0,
        photosLocked: false,
        parkingType: 'unknown',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCredibility(0);
      setPhotoLocked(false);
      setParkingType('unknown');
    } else {
      const data = snapshot.data();
      setCredibility(typeof data.credibilityPercent === 'number' ? Math.max(0, Math.min(100, data.credibilityPercent)) : 0);
      setPhotoLocked(data.photosLocked === true || (typeof data.credibilityPercent === 'number' && data.credibilityPercent >= 90));
      setParkingType(data.parkingType === 'street' || data.parkingType === 'visitor' || data.parkingType === 'private' || data.parkingType === 'none' ? data.parkingType : 'unknown');
    }
    const visibleComments = await getDocs(query(
      collection(db, 'communityAddresses', id, 'comments'),
      where('expiresAt', '>', Timestamp.now()),
      orderBy('expiresAt', 'desc'),
      limit(8),
    ));
    setComments(visibleComments.docs.flatMap((item) => {
      const data = item.data();
      return data.status === 'active' && typeof data.text === 'string' && data.expiresAt instanceof Timestamp
        ? [{ id: item.id, text: data.text, expiresAt: data.expiresAt }]
        : [];
    }));
    setAddressId(id);
    return id;
  }

  async function selectPhoto(useCamera: boolean) {
    if (photoLocked || credibility >= 90) {
      setMessage('Esta dirección ya alcanzó el 90 %: puedes dejar comentarios, pero no subir más fotos.');
      return;
    }
    const user = auth?.currentUser;
    if (!user?.emailVerified) {
      setMessage('Inicia sesión y verifica tu correo para aportar fotos.');
      return;
    }
    try {
      setBusy(true);
      setMessage('');
      const permission = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage(useCamera ? 'Permite el acceso a la cámara para tomar una foto.' : 'Permite el acceso a tus fotos para elegir una imagen.');
        return;
      }
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
      if (!result.canceled && result.assets[0]?.uri) setPhotoUri(result.assets[0].uri);
    } catch {
      setMessage('No se pudo abrir la cámara o galería. Inténtalo nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPhoto() {
    const user = auth?.currentUser;
    if (!photoUri || !user?.emailVerified || !storage || !db) {
      setMessage('Inicia sesión con correo verificado y configura Firebase Storage para subir la foto.');
      return;
    }
    if (photoLocked || credibility >= 90) {
      setMessage('Las fotos están bloqueadas desde el 90 % de credibilidad.');
      return;
    }
    setBusy(true);
    setMessage('');
    let path = '';
    try {
      const id = await prepareAddress(address);
      const addressSnapshot = await getDoc(doc(db, 'communityAddresses', id));
      const addressData = addressSnapshot.data();
      if (addressData?.photosLocked === true || (typeof addressData?.credibilityPercent === 'number' && addressData.credibilityPercent >= 90)) {
        throw new Error('Esta dirección ya está verificada al 90 % y no admite más fotos.');
      }
      if ((await getDoc(doc(db, 'communityAddresses', id, 'contributions', user.uid))).exists()) {
        throw new Error('Ya aportaste una foto para esta dirección. Puedes dejar un comentario.');
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Permite la ubicación para confirmar que estás en esta dirección.');
      const expectedLocation = (await Location.geocodeAsync(`${address.trim()}, Chile`))[0];
      if (!expectedLocation) throw new Error('No pudimos ubicar esta dirección; no subimos la foto.');
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (point.coords.accuracy == null || point.coords.accuracy > MAX_PHOTO_GPS_ACCURACY_METERS) {
        throw new Error('El GPS no tiene suficiente precisión. Espera unos segundos y vuelve a intentarlo.');
      }
      const distance = distanceInMeters(expectedLocation, point);
      if (distance > MAX_PHOTO_DISTANCE_METERS) {
        throw new Error(`No subimos la foto: el GPS te ubica a ${Math.round(distance)} m de esta dirección.`);
      }
      const coordinates = { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracyMeters: point.coords.accuracy };
      const response = await fetch(photoUri);
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error('La foto supera el límite de 10 MB.');
      const contributionId = user.uid;
      path = `community/${id}/${user.uid}/photo.jpg`;
      const imageRef = ref(storage, path);
      await uploadBytes(imageRef, blob, { contentType: blob.type || 'image/jpeg' });
      await setDoc(doc(db, 'communityAddresses', id, 'contributions', contributionId), {
        uid: user.uid,
        storagePath: path,
        status: 'pending',
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        accuracyMeters: coordinates?.accuracyMeters ?? null,
        createdAt: serverTimestamp(),
      });
      setPhotoUri('');
      setMessage('Foto enviada para revisión. Solo las fotos aprobadas aportarán a la credibilidad y a las recompensas.');
    } catch (error) {
      if (path && storage) await deleteObject(ref(storage, path)).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : 'No se pudo subir la foto. Verifica que Firebase Storage esté habilitado.');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    const cleanComment = comment.trim().slice(0, 280);
    const user = auth?.currentUser;
    if (!cleanComment) { setMessage('Escribe un comentario breve antes de enviarlo.'); return; }
    if (!user?.emailVerified || !db) { setMessage('Inicia sesión con correo verificado para dejar comentarios.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const id = await prepareAddress(address);
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      await addDoc(collection(db, 'communityAddresses', id, 'comments'), {
        uid: user.uid,
        text: cleanComment,
        status: 'active',
        createdAt: serverTimestamp(),
        expiresAt,
      });
      setComment('');
      const latest = await getDocs(query(
        collection(db, 'communityAddresses', id, 'comments'),
        where('expiresAt', '>', Timestamp.now()),
        orderBy('expiresAt', 'desc'),
        limit(8),
      ));
      setComments(latest.docs.flatMap((item) => {
        const data = item.data();
        return data.status === 'active' && typeof data.text === 'string' && data.expiresAt instanceof Timestamp
          ? [{ id: item.id, text: data.text, expiresAt: data.expiresAt }]
          : [];
      }));
      setMessage('Comentario guardado. Su vigencia es de 30 días.');
    } catch {
      setMessage('No se pudo guardar el comentario. Revisa Firebase y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  }

  async function selectParkingType(value: ParkingType) {
    if (!addressId || !db || value === 'unknown') return;
    const user = auth?.currentUser;
    if (!user?.emailVerified) { setMessage('Inicia sesión con correo verificado para aportar el estacionamiento.'); return; }
    setBusy(true);
    setMessage('');
    try {
      await updateDoc(doc(db, 'communityAddresses', addressId), { parkingType: value, updatedAt: serverTimestamp() });
      setParkingType(value);
      setMessage('Opción de estacionamiento guardada para esta dirección.');
    } catch {
      setMessage('Esta dirección ya tiene una opción de estacionamiento o no se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  function onAddressChange(value: string) {
    setAddress(value);
    setAddressId('');
    setCredibility(0);
    setPhotoLocked(false);
    setParkingType('unknown');
    setPhotoUri('');
    setMessage('');
  }

  return (
    <ThemeLayer><SafeAreaView style={styles.safeArea}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Link href={fromDelivery === 'true' ? '/ruta' : '/'} asChild><Pressable style={styles.back}><Text style={styles.backText}>{fromDelivery === 'true' ? '‹  Volver a la ruta' : '‹  Inicio'}</Text></Pressable></Link>
        <Text style={styles.eyebrow}>COMUNIDAD CONNECT</Text>
        <Text style={styles.title}>Datos de direcciones</Text>
        <Text style={styles.subtitle}>Aporta información útil del acceso, estacionamiento o conserjería. Tu aporte es opcional y no cambia el estado de tus entregas.</Text>
        {fromDelivery === 'true' && <View style={styles.deliveryBanner}><Text style={styles.deliveryBannerTitle}>Aporte de la parada entregada</Text><Text style={styles.deliveryBannerText}>La dirección ya está vinculada. Antes de enviar la foto confirmaremos que el GPS esté cerca.</Text></View>}

        <View style={styles.card}>
          <Text style={styles.label}>DOMICILIO</Text>
          <TextInput value={address} onChangeText={onAddressChange} placeholder="Calle, número y comuna" placeholderTextColor="#91A098" style={styles.input} maxLength={500} onBlur={() => { if (address.trim()) void prepareAddress().catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo consultar esta dirección.')); }} />
          <Pressable style={styles.secondaryButton} onPress={() => void prepareAddress().then(() => setMessage('Dirección lista para consultar o aportar.')).catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudo consultar esta dirección.'))} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Consultar credibilidad</Text>
          </Pressable>
        </View>

        <View style={styles.credibilityCard}>
          <View style={styles.credibilityTop}><Text style={styles.credibilityTitle}>Credibilidad comunitaria</Text><View style={styles.credibilityRight}>{(photoLocked || credibility >= 90) && <Text style={styles.verifiedBadge}>✓ VERIFICADA</Text>}<Text style={styles.credibilityValue}>{credibility}%</Text></View></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${credibility}%` }]} /></View>
          <Text style={styles.helper}>{photoLocked || credibility >= 90 ? 'Dirección verificada: nuevas fotos bloqueadas. Los comentarios siguen disponibles.' : 'Las fotos se envían para revisión; las aprobadas aumentan este porcentaje.'}</Text>
        </View>

        {addressId !== '' && <View style={styles.card}>
          <Text style={styles.cardTitle}>Estacionamiento</Text>
          <Text style={styles.helper}>Opción informada: {parkingLabels[parkingType]}.</Text>
          {parkingType === 'unknown' ? <View style={styles.parkingOptions}>{parkingOptions.map((option) => <Pressable key={option.value} style={styles.parkingOption} onPress={() => void selectParkingType(option.value)} disabled={busy}><Text style={styles.parkingOptionText}>{option.label}</Text></Pressable>)}</View> : <Text style={styles.parkingSaved}>✓ Aporte registrado</Text>}
        </View>}

        <View style={styles.card} onLayout={(event) => { photoSectionY.current = event.nativeEvent.layout.y; }}>
          <Text style={styles.cardTitle}>Aporta una foto</Text>
          <Text style={styles.helper}>Toma una foto real del acceso o estacionamiento. Solo se enviará si el GPS confirma que estás cerca de la dirección.</Text>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" /> : null}
          <View style={styles.photoActions}>
            <Pressable style={[styles.secondaryButton, styles.photoAction, (photoLocked || credibility >= 90 || busy) && styles.disabled]} onPress={() => void selectPhoto(true)} disabled={busy || photoLocked || credibility >= 90}><Text style={styles.secondaryButtonText}>Tomar foto</Text></Pressable>
            <Pressable style={[styles.secondaryButton, styles.photoAction, (photoLocked || credibility >= 90 || busy) && styles.disabled]} onPress={() => void selectPhoto(false)} disabled={busy || photoLocked || credibility >= 90}><Text style={styles.secondaryButtonText}>Elegir foto</Text></Pressable>
          </View>
          {photoUri ? <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={() => void submitPhoto()} disabled={busy}><Text style={styles.primaryText}>{busy ? 'Enviando…' : 'Enviar para revisión'}</Text></Pressable> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Deja un comentario</Text>
          <Text style={styles.helper}>Los comentarios duran 30 días. No incluyas nombres, teléfonos ni datos personales.</Text>
          <TextInput value={comment} onChangeText={setComment} placeholder="Ej.: acceso por portón lateral…" placeholderTextColor="#91A098" style={[styles.input, styles.commentInput]} multiline maxLength={280} />
          <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={() => void submitComment()} disabled={busy}><Text style={styles.primaryText}>Guardar comentario</Text></Pressable>
        </View>

        {comments.length > 0 && <View style={styles.card}>
          <Text style={styles.cardTitle}>Comentarios recientes</Text>
          {comments.map((item) => <View key={item.id} style={styles.commentRow}>
            <Text style={styles.commentText}>{item.text}</Text>
            <Text style={styles.commentExpiry}>Vence el {item.expiresAt.toDate().toLocaleDateString('es-CL')}</Text>
          </View>)}
        </View>}

        {busy && <ActivityIndicator style={styles.spinner} color={colors.green} />}
        {!!message && <View accessibilityRole="alert" style={styles.messageCard}><Text style={styles.message}>{message}</Text></View>}
        {!isFirebaseConfigured && <View style={styles.messageCard}><Text style={styles.message}>Firebase no está conectado; los aportes comunitarios necesitan una cuenta verificada y almacenamiento en la nube.</Text></View>}
      </ScrollView>
    </SafeAreaView></ThemeLayer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.pale },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 116 },
  deliveryBanner: { backgroundColor: '#E7EDE3', borderRadius: 14, padding: 13, marginBottom: 13 }, deliveryBannerTitle: { color: colors.green, fontSize: 12, fontWeight: '800' }, deliveryBannerText: { color: colors.ink, fontSize: 11, lineHeight: 16, marginTop: 4 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 14, marginBottom: 20 },
  backText: { color: colors.green, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  input: { minHeight: 48, color: colors.ink, fontSize: 13, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 12 },
  secondaryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  credibilityCard: { backgroundColor: '#E7EDE3', borderRadius: 17, padding: 16, marginBottom: 12 },
  credibilityRight: { flexDirection: 'row', alignItems: 'center', gap: 8 }, verifiedBadge: { color: '#FFFFFF', backgroundColor: colors.green, fontSize: 8, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8 },
  parkingOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, parkingOption: { backgroundColor: '#EAF1E8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }, parkingOptionText: { color: colors.green, fontSize: 10, fontWeight: '700' }, parkingSaved: { color: colors.green, fontSize: 10, fontWeight: '700', marginTop: 10 },
  credibilityTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  credibilityTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  credibilityValue: { color: colors.green, fontSize: 18, fontWeight: '800' },
  progressTrack: { height: 7, overflow: 'hidden', backgroundColor: '#CFDBCA', borderRadius: 4, marginTop: 11 },
  progressFill: { height: 7, backgroundColor: colors.green, borderRadius: 4 },
  helper: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 8 },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  preview: { width: '100%', height: 190, borderRadius: 13, marginTop: 12, backgroundColor: colors.pale },
  photoActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  photoAction: { flex: 1 },
  primaryButton: { minHeight: 45, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, borderRadius: 12, marginTop: 10 },
  primaryText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  commentInput: { minHeight: 76, textAlignVertical: 'top', paddingTop: 11, borderWidth: 1, borderRadius: 11, borderColor: colors.line, paddingHorizontal: 11, marginTop: 12 },
  commentRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 10 },
  commentText: { color: colors.ink, fontSize: 11, lineHeight: 17 },
  commentExpiry: { color: colors.muted, fontSize: 9, marginTop: 4 },
  spinner: { marginVertical: 10 },
  messageCard: { padding: 13, borderRadius: 12, backgroundColor: '#E7EDE3', marginBottom: 12 },
  message: { color: colors.ink, fontSize: 11, lineHeight: 17 },
});
