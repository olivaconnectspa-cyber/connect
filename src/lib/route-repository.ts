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
};

export type TodayRoute = {
  id: string;
  date: string;
  name: string;
  status: 'active' | 'completed';
  deliveries: Delivery[];
  startedAt: number | null;
  completedAt: number | null;
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
    };
  }));
}

function requireDb() {
  if (!db) throw new Error('firebase-not-configured');
  return db;
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
  const routeRef = getRouteRef(userId);
  const routeSnapshot = await getDoc(routeRef);
  if (!routeSnapshot.exists()) return null;

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
      };
    }),
  };
}

export async function markTodayRouteStarted(userId: string): Promise<number> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId);
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

export async function completeTodayRoute(userId: string): Promise<void> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId);
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
  details: { customerCount?: number; recordCount?: number; displayNumber?: string } = {},
): Promise<Delivery> {
  const firestore = requireDb();
  const routeId = getLocalDateKey();
  const routeRef = getRouteRef(userId, routeId);
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
    const routeDate = routeId;
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
      createdAt: routeData?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    transaction.set(deliveryRef, {
      ownerId: userId,
      address: cleanAddress,
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
  };
}

export async function incrementDeliveryRecordCount(userId: string, deliveryId: string): Promise<void> {
  const firestore = requireDb();
  const deliveryRef = doc(collection(getRouteRef(userId), 'deliveries'), deliveryId);
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

export async function updateDeliveryNote(userId: string, deliveryId: string, note: string): Promise<void> {
  await updateDoc(doc(collection(getRouteRef(userId), 'deliveries'), deliveryId), {
    note: note.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });
}

export async function updateDeliveryOrder(
  userId: string,
  orderedStops: Array<{ id: string; sequence: number; displayNumber: string }>,
): Promise<void> {
  const firestore = requireDb();
  for (let offset = 0; offset < orderedStops.length; offset += 400) {
    const batch = writeBatch(firestore);
    for (const stop of orderedStops.slice(offset, offset + 400)) {
      batch.update(doc(collection(getRouteRef(userId), 'deliveries'), stop.id), {
        sequence: stop.sequence,
        displayNumber: stop.displayNumber,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

export async function updateTodayRouteName(userId: string, name: string): Promise<string> {
  const firestore = requireDb();
  const routeId = getLocalDateKey();
  const routeRef = getRouteRef(userId, routeId);
  const cleanName = name.trim().slice(0, 60) || DEFAULT_ROUTE_NAME;
  await runTransaction(firestore, async (transaction) => {
    const routeSnapshot = await transaction.get(routeRef);
    const routeData = routeSnapshot.exists() ? routeSnapshot.data() : null;
    if (routeData?.status === 'completed') throw new Error('route-completed');
    const timestamp = serverTimestamp();
    transaction.set(routeRef, {
      ownerId: userId,
      routeDate: routeId,
      routeName: cleanName,
      status: 'active',
      stopCount: typeof routeData?.stopCount === 'number' ? routeData.stopCount : 0,
      nextSequence: typeof routeData?.nextSequence === 'number' ? routeData.nextSequence : 1,
      startAddress: typeof routeData?.startAddress === 'string' ? routeData.startAddress : '',
      endAddress: typeof routeData?.endAddress === 'string' ? routeData.endAddress : '',
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

export async function removeDeliveryFromTodayRoute(userId: string, deliveryId: string): Promise<void> {
  const firestore = requireDb();
  const routeRef = getRouteRef(userId);
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
      updatedAt: serverTimestamp(),
    });
  });
}

export async function updateDeliveryStatus(
  userId: string,
  deliveryId: string,
  status: DeliveryStatus,
  failureReason: string | null = null,
): Promise<void> {
  if (status === 'failed' && !failureReason?.trim()) {
    throw new Error('failure-reason-required');
  }

  const deliveryRef = doc(
    collection(getRouteRef(userId), 'deliveries'),
    deliveryId,
  );
  await updateDoc(deliveryRef, {
    status,
    failureReason: status === 'failed' ? failureReason?.trim() : null,
    deliveredAt: status === 'delivered' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}
