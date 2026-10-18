import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { normalizeDeliveryAddress } from './csv';

const MAX_DISTANCE_METERS = 150;
const MAX_ACCURACY_METERS = 80;

function communityAddressId(address: string) {
  const normalized = normalizeDeliveryAddress(address);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(hash ^ normalized.charCodeAt(index), 16777619);
  }
  return `${normalized.replace(/[^a-z0-9]+/g, '-').slice(0, 70)}-${(hash >>> 0).toString(36)}`;
}

/** Returns false when photos are locked, the user already contributed, or Firebase is unavailable. */
export async function canOfferParkingPhoto(address: string): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user?.emailVerified || !db || !storage) return false;

  const id = communityAddressId(address.trim().slice(0, 500));
  const addressSnapshot = await getDoc(doc(db, 'communityAddresses', id));
  if (addressSnapshot.exists()) {
    const data = addressSnapshot.data();
    if (data.photosLocked === true || (typeof data.credibilityPercent === 'number' && data.credibilityPercent >= 90)) return false;
  }

  const contributionSnapshot = await getDoc(doc(db, 'communityAddresses', id, 'contributions', user.uid));
  return !contributionSnapshot.exists();
}

function distanceInMeters(left: Location.LocationGeocodedLocation, right: Location.LocationObject) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(right.coords.latitude - left.latitude);
  const longitudeDelta = radians(right.coords.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.coords.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Captures and uploads a parking/access photo only when GPS places the driver near the delivery address. */
export async function captureVerifiedParkingPhoto(address: string): Promise<'cancelled' | 'uploaded'> {
  const user = auth?.currentUser;
  if (!user?.emailVerified || !db || !storage) {
    throw new Error('Inicia sesión con correo verificado y verifica que Firebase Storage esté configurado.');
  }

  const cleanAddress = address.trim().slice(0, 500);
  const id = communityAddressId(cleanAddress);
  const addressRef = doc(db, 'communityAddresses', id);
  const existingAddress = await getDoc(addressRef);
  if (existingAddress.exists()) {
    const data = existingAddress.data();
    if (data.photosLocked === true || (typeof data.credibilityPercent === 'number' && data.credibilityPercent >= 90)) {
      throw new Error('Esta dirección ya está verificada al 90 %; no admite más fotos.');
    }
  }

  const contributionRef = doc(db, 'communityAddresses', id, 'contributions', user.uid);
  if ((await getDoc(contributionRef)).exists()) {
    throw new Error('Ya aportaste una foto para esta dirección. Puedes dejar un comentario desde Direcciones.');
  }

  const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
  if (!cameraPermission.granted) throw new Error('Permite el acceso a la cámara para tomar la foto.');
  const locationPermission = await Location.requestForegroundPermissionsAsync();
  if (!locationPermission.granted) throw new Error('Permite el acceso a la ubicación para verificar que estás en la dirección.');

  const expectedLocation = (await Location.geocodeAsync(`${cleanAddress}, Chile`))[0];
  if (!expectedLocation) throw new Error('No pudimos ubicar esta dirección en el mapa; no subimos la foto.');

  const photo = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 });
  if (photo.canceled || !photo.assets[0]?.uri) return 'cancelled';

  const coordinates = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (coordinates.coords.accuracy == null || coordinates.coords.accuracy > MAX_ACCURACY_METERS) {
    throw new Error('El GPS no tiene suficiente precisión. Espera unos segundos y vuelve a tomar la foto.');
  }
  const distance = distanceInMeters(expectedLocation, coordinates);
  if (distance > MAX_DISTANCE_METERS) {
    throw new Error(`La foto no se subió: el GPS te ubica a ${Math.round(distance)} m de esta dirección.`);
  }

  if (!existingAddress.exists()) {
    await setDoc(addressRef, {
      canonicalAddress: normalizeDeliveryAddress(cleanAddress),
      address: cleanAddress,
      credibilityPercent: 0,
      photosLocked: false,
      parkingType: 'unknown',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const imageResponse = await fetch(photo.assets[0].uri);
  const blob = await imageResponse.blob();
  if (blob.size > 10 * 1024 * 1024) throw new Error('La foto supera el límite de 10 MB.');

  const path = `community/${id}/${user.uid}/photo.jpg`;
  await uploadBytes(ref(storage, path), blob, { contentType: blob.type || 'image/jpeg' });
  try {
    await setDoc(contributionRef, {
      uid: user.uid,
      storagePath: path,
      status: 'pending',
      latitude: coordinates.coords.latitude,
      longitude: coordinates.coords.longitude,
      accuracyMeters: coordinates.coords.accuracy,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    await deleteObject(ref(storage, path)).catch(() => undefined);
    throw error;
  }
  return 'uploaded';
}
