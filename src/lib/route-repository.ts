import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_ROUTE_NAME } from './stops';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export type Delivery = {
  id: string;
  address: string;
  customerCount: number;
  recordCount: number;
  note: string;
  displayNumber: string;
  sequence: number;
  status: DeliveryStatus;
  failureReason: string | null;
  proofPhotoUrl: string | null;
  customerPhone?: string;
  customerName?: string;
};

export type TodayRoute = {
  id: string;
  date: string;
  name: string;
  status: 'active' | 'completed';
  deliveries: Delivery[];
  startedAt: number | null;
  completedAt: number | null;
  isOptimized: boolean;
  startAddress: string;
  endAddress: string;
  endAtLastStop: boolean;
};

export type SharedRouteSnapshot = {
  name: string;
  stops: Array<{
    address: string;
    packageNumber: string;
    customerName: string;
    customerPhone: string;
    status: DeliveryStatus;
  }>;
};

function timestampToMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

export async function loadRouteHistory(userId: string): Promise<TodayRoute[]> {
  const routesQuery = query(
    collection(requireDb(), 'users', userId, 'routes'),
    where('ownerId', '==', userId),
    orderBy('routeDate', 'desc'),
    limit(30),
  );
  const routeSnapshots = await getDocs(routesQuery);
  return Promise.all(routeSnapshots.docs.map(async (routeSnapshot) => {
    const routeRef = routeSnapshot.ref;
    const deliverySnapshots = await getDocs(query(
      collection(routeRef, 'deliveries'),
      orderBy('sequence', 'asc'),
    ));
    const routeData = routeSnapshot.data();
    const deliveries: Delivery[] = deliverySnapshots.docs.map((deliverySnapshot) => {
      const data = deliverySnapshot.data();
      const status = data.status;
      return {
        id: deliverySnapshot.id,
        address: typeof data.address === 'string' ? data.address : '',
        customerCount: typeof data.customerCount === 'number' && data.customerCount >= 0 ? data.customerCount : 0,
        recordCount: typeof data.recordCount === 'number' && data.recordCount >= 0 ? data.recordCount : (typeof data.packageCount === 'number' && data.packageCount > 0 ? data.packageCount : 0),
        note: typeof data.note === 'string' ? data.note : '',
        sequence: typeof data.sequence === 'number' ? data.sequence : 0,
        displayNumber: typeof data.displayNumber === 'string' ? data.displayNumber : String(typeof data.sequence === 'number' ? data.sequence : 0),
        status: status === 'delivered' || status === 'failed' ? status : 'pending',
        failureReason: typeof data.failureReason === 'string' ? data.failureReason : null,
        proofPhotoUrl: typeof data.proofPhotoUrl === 'string' ? data.proofPhotoUrl : null,
        customerPhone: typeof data.customerPhone === 'string' ? data.customerPhone : '',
        customerName: typeof data.customerName === 'string' ? data.customerName : '',
      };
    });
    return {
      id: routeSnapshot.id,
      date: typeof routeData.routeDate === 'string' ? routeData.routeDate : routeSnapshot.id,
      name: typeof routeData.routeName === 'string' ? routeData.routeName : DEFAULT_ROUTE_NAME,
      status: routeData.status === 'completed' ? 'completed' as const : 'active' as const,
      deliveries,
      startedAt: timestampToMillis(routeData.startedAt),
      completedAt: timestampToMillis(routeData.completedAt),
      isOptimized: routeData.isOptimized === true,
      startAddress: typeof routeData.startAddress === 'string' ? routeData.startAddress : '',
      endAddress: typeof routeData.endAddress === 'string' ? routeData.endAddress : '',
      endAtLastStop: typeof routeData.endAddress !== 'string' || routeData.endAddress.trim() === '',
    };
  }));
}

function requireDb() {
  if (!db) throw new Error('firebase-not-configured');
  return db;
}

export async function createSharedRouteLink(userId: string, route: SharedRouteSnapshot): Promise<string> {
  const routeRef = doc(collection(requireDb(), 'sharedRoutes'));
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  await setDoc(routeRef, {
    ownerId: userId,
    name: route.name.slice(0, 60),
    stops: route.stops.slice(0, 100).map((stop) => ({
      address: stop.address.slice(0, 500),
      packageNumber: stop.packageNumber.slice(0, 12),
      customerName: stop.customerName.slice(0, 200),
      customerPhone: stop.customerPhone.slice(0, 30),
      status: stop.status,
    })),
    isOptimized: true,
    createdAt: serverTimestamp(),
    expiresAt,
  });
  return routeRef.id;
}

export async function loadSharedRouteLink(shareId: string): Promise<SharedRouteSnapshot | null> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(shareId)) return null;
  const snapshot = await getDoc(doc(requireDb(), 'sharedRoutes', shareId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!(data.expiresAt instanceof Date) && !(data.expiresAt && typeof data.expiresAt === 'object' && 'toMillis' in data.expiresAt && typeof data.expiresAt.toMillis === 'function')) return null;
  if (timestampToMillis(data.expiresAt) === null || timestampToMillis(data.expiresAt)! <= Date.now()) return null;
  if (typeof data.name !== 'string' || !Array.isArray(data.stops) || data.stops.length < 1 || data.stops.length > 100) return null;
  const stops = data.stops.flatMap((item: unknown): SharedRouteSnapshot['stops'] => {
    if (!item || typeof item !== 'object') return [];
    const stop = item as Record<string, unknown>;
    if (typeof stop.address !== 'string' || !stop.address.trim() || stop.address.length > 500) return [];
    const packageNumber = typeof stop.packageNumber === 'string' && /^\d+(?:\.\d+)?$/.test(stop.packageNumber)
      ? stop.packageNumber.slice(0, 12)
      : '';
    const status = stop.status === 'delivered' || stop.status === 'failed' ? stop.status : stop.status === 'pending' ? 'pending' : null;
    const customerName = typeof stop.customerName === 'string' ? stop.customerName.slice(0, 200) : '';
    const customerPhone = typeof stop.customerPhone === 'string' ? stop.customerPhone.slice(0, 30) : '';
    return packageNumber && status ? [{ address: stop.address, packageNumber, customerName, customerPhone, status }] : [];
  });
  if (stops.length !== data.stops.length) return null;
  return { name: data.name.slice(0, 60), stops };
}

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRouteRef(userId: string, routeId = getLocalDateKey()) {
  return doc(requireDb(), 'users', userId, 'routes', routeId);
}

export async function loadTodayRoute(userId: string): Promise<TodayRoute | null> {
  const today = getLocalDateKey();
  const routesSnapshot = await getDocs(query(
    collection(requireDb(), 'users', userId, 'routes'),
    where('ownerId', '==', userId),
    where('routeDate', '==', today),
  ));
  const todayRoutes = routesSnapshot.docs.sort((left, right) => {
    const leftData = left.data();
    const rightData = right.data();
    if (leftData.status !== rightData.status) return leftData.status === 'active' ? -1 : 1;
    return (timestampToMillis(rightData.createdAt) ?? 0) - (timestampToMillis(leftData.createdAt) ?? 0);
  });
  const routeSnapshot = todayRoutes[0];
  if (!routeSnapshot) return null;
  const routeRef = routeSnapshot.ref;

  const deliveriesQuery = query(
    collection(routeRef, 'deliveries'),
    orderBy('sequence', 'asc'),
  );
  const deliveriesSnapshot = await getDocs(deliveriesQuery);
  const routeData = routeSnapshot.data();

  return {
    id: routeSnapshot.id,
    date: typeof routeData.routeDate === 'string' ? routeData.routeDate : routeSnapshot.id,
    name: typeof routeData.routeName === 'string' ? routeData.routeName : DEFAULT_ROUTE_NAME,
    status: routeData.status === 'completed' ? 'completed' : 'active',
    startedAt: timestampToMillis(routeData.startedAt),
    completedAt: timestampToMillis(routeData.completedAt),
    isOptimized: routeData.isOptimized === true,
    startAddress: typeof routeData.startAddress === 'string' ? routeData.startAddress : '',
    endAddress: typeof routeData.endAddress === 'string' ? routeData.endAddress : '',
    endAtLastStop: typeof routeData.endAddress !== 'string' || routeData.endAddress.trim() === '',
    deliveries: deliveriesSnapshot.docs.map((deliverySnapshot) => {
      const deliveryData = deliverySnapshot.data();
      const status = deliveryData.status;
      return {
        id: deliverySnapshot.id,
        address: typeof deliveryData.address === 'string' ? deliveryData.address : '',
        customerCount: typeof deliveryData.customerCount === 'number' && deliveryData.customerCount >= 0 ? deliveryData.customerCount : 0,
        recordCount: typeof deliveryData.recordCount === 'number' && deliveryData.recordCount >= 0 ? deliveryData.recordCount : (typeof deliveryData.packageCount === 'number' && deliveryData.packageCount > 0 ? deliveryData.packageCount : 0),
        note: typeof deliveryData.note === 'string' ? deliveryData.note : '',
        sequence: typeof deliveryData.sequence === 'number' ? deliveryData.sequence : 0,
        displayNumber: typeof deliveryData.displayNumber === 'string' ? deliveryData.displayNumber : String(typeof deliveryData.sequence === 'number' ? deliveryData.sequence : 0),
        status: status === 'delivered' || status === 'failed' ? status : 'pending',
        failureReason: typeof deliveryData.failureReason === 'string' ? deliveryData.failureReason : null,
        proofPhotoUrl: typeof deliveryData.proofPhotoUrl === 'string' ? deliveryData.proofPhotoUrl : null,
        customerPhone: typeof deliveryData.customerPhone === 'string' ? deliveryData.customerPhone : '',
        customerName: typeof deliveryData.customerName === 'string' ? deliveryData.customerName : '',
      };
    }),
  };
}

export async function createTodayRoute(userId: string): Promise<string> {
  const firestore = requireDb();
  const routeRef = doc(collection(firestore, 'users', userId, 'routes'));
  const now = serverTimestamp();
  await setDoc(routeRef, {
    ownerId: userId,
    routeDate: getLocalDateKey(),
    routeName: DEFAULT_ROUTE_NAME,
    status: 'active',
    stopCount: 0,
    nextSequence: 1,
    startAddress: '',
    endAddress: '',
    isOptimized: false,
    createdAt: now,
    updatedAt: now,
  });
  return routeRef.id;
}

export async function markTodayRouteStarted(userId: string, routeId?: string): Promise<number> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId, routeId);
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(routeRef);
    if (!snapshot.exists()) throw new Error('route-not-found');
    const routeData = snapshot.data();
    if (routeData.status === 'completed') throw new Error('route-completed');
    const startedAt = timestampToMillis(routeData.startedAt) ?? Date.now();
    transaction.update(routeRef, {
      startedAt: routeData.startedAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return startedAt;
  });
}

export async function updateRouteEndpoints(userId: string, startAddress: string, endAddress: string, endAtLastStop: boolean, routeId?: string): Promise<void> {
  await updateDoc(getRouteRef(userId, routeId), {
    startAddress: startAddress.trim().slice(0, 500),
    endAddress: endAtLastStop ? '' : endAddress.trim().slice(0, 500),
    updatedAt: serverTimestamp(),
  });
}

export async function completeTodayRoute(userId: string, routeId?: string): Promise<void> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId, routeId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(routeRef);
    if (!snapshot.exists()) throw new Error('route-not-found');
    if (snapshot.data().status === 'completed') return;
    transaction.update(routeRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function deleteRouteHistory(userId: string, routeId: string): Promise<void> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId, routeId);
  const deliveries = await getDocs(collection(routeRef, 'deliveries'));
  for (let offset = 0; offset < deliveries.docs.length; offset += 450) {
    const batch = writeBatch(firestore);
    for (const delivery of deliveries.docs.slice(offset, offset + 450)) batch.delete(delivery.ref);
    await batch.commit();
  }
  await deleteDoc(routeRef);
}

export async function addDeliveryToTodayRoute(
  userId: string,
  address: string,
  details: { customerCount?: number; recordCount?: number; displayNumber?: string; customerPhone?: string; customerName?: string } = {},
  routeId?: string,
): Promise<Delivery> {
  const firestore = requireDb();
  const selectedRouteId = routeId ?? getLocalDateKey();
  const routeRef = getRouteRef(userId, selectedRouteId);
  const deliveryRef = doc(collection(routeRef, 'deliveries'));
  const cleanAddress = address.trim();
  if (!cleanAddress || cleanAddress.length > 500) {
    throw new Error('invalid-address');
  }
  const displayNumber = details.displayNumber?.trim();
  const customSequence = displayNumber ? Number(displayNumber) : null;
  if (displayNumber && (!/^\d+(?:\.\d+)?$/.test(displayNumber) || !customSequence || !Number.isFinite(customSequence))) {
    throw new Error('invalid-display-number');
  }

  const sequence = await runTransaction(firestore, async (transaction) => {
    const routeSnapshot = await transaction.get(routeRef);
    const routeData = routeSnapshot.exists() ? routeSnapshot.data() : null;
    if (routeData?.status === 'completed') throw new Error('route-completed');

    const currentCount = typeof routeData?.stopCount === 'number' ? routeData.stopCount : 0;
    const nextSequence = typeof routeData?.nextSequence === 'number'
      ? routeData.nextSequence
      : currentCount + 1;
    const sequence = customSequence ?? nextSequence;
    const routeDate = getLocalDateKey();
    const timestamp = serverTimestamp();

    transaction.set(routeRef, {
      ownerId: userId,
      routeDate,
      status: 'active',
      routeName: typeof routeData?.routeName === 'string' ? routeData.routeName : DEFAULT_ROUTE_NAME,
      stopCount: currentCount + 1,
      nextSequence: nextSequence + 1,
      startAddress: typeof routeData?.startAddress === 'string' ? routeData.startAddress : '',
      endAddress: typeof routeData?.endAddress === 'string' ? routeData.endAddress : '',
      isOptimized: displayNumber ? routeData?.isOptimized === true : false,
      createdAt: routeData?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    transaction.set(deliveryRef, {
      ownerId: userId,
      address: cleanAddress,
      customerPhone: (details.customerPhone ?? '').trim().slice(0, 30),
      customerName: (details.customerName ?? '').trim().slice(0, 200),
      customerCount: Math.max(0, Math.floor(details.customerCount ?? 0)),
      recordCount: Math.max(0, Math.floor(details.recordCount ?? 0)),
      note: '',
      sequence,
      displayNumber: displayNumber ?? String(sequence),
      status: 'pending',
      failureReason: null,
      proofPhotoUrl: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveredAt: null,
    });

    return sequence;
  });

  return {
    id: deliveryRef.id,
    address: cleanAddress,
    customerCount: Math.max(0, Math.floor(details.customerCount ?? 0)),
    recordCount: Math.max(0, Math.floor(details.recordCount ?? 0)),
    note: '',
    sequence: customSequence ?? sequence,
    displayNumber: displayNumber ?? String(customSequence ?? sequence),
    status: 'pending',
    failureReason: null,
    proofPhotoUrl: null,
    customerPhone: (details.customerPhone ?? '').trim().slice(0, 30),
    customerName: (details.customerName ?? '').trim().slice(0, 200),
  };
}

export async function incrementDeliveryRecordCount(userId: string, deliveryId: string, routeId?: string): Promise<void> {
  const firestore = requireDb();
  const deliveryRef = doc(collection(getRouteRef(userId, routeId), 'deliveries'), deliveryId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(deliveryRef);
    if (!snapshot.exists()) throw new Error('delivery-not-found');
    const currentCount = typeof snapshot.data().recordCount === 'number' ? snapshot.data().recordCount : 0;
    transaction.update(deliveryRef, {
      recordCount: Math.max(1, currentCount) + 1,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function updateDeliveryNote(userId: string, deliveryId: string, note: string, routeId?: string): Promise<void> {
  await updateDoc(doc(collection(getRouteRef(userId, routeId), 'deliveries'), deliveryId), {
    note: note.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });
}

export async function updateDeliveryPhone(userId: string, deliveryId: string, customerPhone: string, routeId?: string): Promise<void> {
  await updateDoc(doc(collection(getRouteRef(userId, routeId), 'deliveries'), deliveryId), {
    customerPhone: customerPhone.trim().slice(0, 30),
    updatedAt: serverTimestamp(),
  });
}

export async function updateDeliveryOrder(
  userId: string,
  orderedStops: Array<{ id: string; sequence: number; displayNumber: string }>,
  routeId?: string,
): Promise<void> {
  const firestore = requireDb();
  for (let offset = 0; offset < orderedStops.length; offset += 400) {
    const batch = writeBatch(firestore);
    for (const stop of orderedStops.slice(offset, offset + 400)) {
      batch.update(doc(collection(getRouteRef(userId, routeId), 'deliveries'), stop.id), {
        sequence: stop.sequence,
        displayNumber: stop.displayNumber,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await updateDoc(getRouteRef(userId, routeId), { isOptimized: true, updatedAt: serverTimestamp() });
}

export async function updateTodayRouteName(userId: string, name: string, routeId?: string): Promise<string> {
  const firestore = requireDb();
  const selectedRouteId = routeId ?? getLocalDateKey();
  const routeRef = getRouteRef(userId, selectedRouteId);
  const cleanName = name.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
  await runTransaction(firestore, async (transaction) => {
    const routeSnapshot = await transaction.get(routeRef);
    const routeData = routeSnapshot.exists() ? routeSnapshot.data() : null;
    const timestamp = serverTimestamp();
    transaction.set(routeRef, {
      ownerId: userId,
      routeDate: getLocalDateKey(),
      routeName: cleanName,
      status: routeData?.status === 'completed' ? 'completed' : 'active',
      stopCount: typeof routeData?.stopCount === 'number' ? routeData.stopCount : 0,
      nextSequence: typeof routeData?.nextSequence === 'number' ? routeData.nextSequence : 1,
      startAddress: typeof routeData?.startAddress === 'string' ? routeData.startAddress : '',
      endAddress: typeof routeData?.endAddress === 'string' ? routeData.endAddress : '',
      isOptimized: routeData?.isOptimized === true,
      createdAt: routeData?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  });
  return cleanName;
}

export async function updateRouteName(userId: string, routeId: string, name: string): Promise<string> {
  const cleanName = name.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
  await updateDoc(doc(requireDb(), 'users', userId, 'routes', routeId), {
    routeName: cleanName,
    updatedAt: serverTimestamp(),
  });
  return cleanName;
}

export async function removeDeliveryFromTodayRoute(userId: string, deliveryId: string, routeId?: string, preserveOptimization = false): Promise<void> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId, routeId);
  const deliveryRef = doc(collection(routeRef, 'deliveries'), deliveryId);

  await runTransaction(firestore, async (transaction) => {
    const routeSnapshot = await transaction.get(routeRef);
    const deliverySnapshot = await transaction.get(deliveryRef);
    if (!routeSnapshot.exists() || !deliverySnapshot.exists()) return;

    const routeData = routeSnapshot.data();
    const currentCount = typeof routeData.stopCount === 'number' ? routeData.stopCount : 0;
    transaction.delete(deliveryRef);
    transaction.update(routeRef, {
      stopCount: Math.max(0, currentCount - 1),
      isOptimized: preserveOptimization && currentCount > 1,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function updateDeliveryStatus(
  userId: string,
  deliveryId: string,
  status: DeliveryStatus,
  failureReason: string | null = null,
  routeId?: string,
): Promise<void> {
  const deliveryRef = doc(
    collection(getRouteRef(userId, routeId), 'deliveries'),
    deliveryId,
  );
  await updateDoc(deliveryRef, {
    status,
    failureReason: status === 'failed' ? failureReason?.trim() || null : null,
    deliveredAt: status === 'delivered' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}
