import {
  collection,
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
} from 'firebase/firestore';
import { db } from './firebase';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export type Delivery = {
  id: string;
  address: string;
  sequence: number;
  status: DeliveryStatus;
  failureReason: string | null;
  proofPhotoUrl: string | null;
};

export type TodayRoute = {
  id: string;
  date: string;
  status: 'active' | 'completed';
  deliveries: Delivery[];
};

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
        sequence: typeof data.sequence === 'number' ? data.sequence : 0,
        status: status === 'delivered' || status === 'failed' ? status : 'pending',
        failureReason: typeof data.failureReason === 'string' ? data.failureReason : null,
        proofPhotoUrl: typeof data.proofPhotoUrl === 'string' ? data.proofPhotoUrl : null,
      };
    });
    return {
      id: routeSnapshot.id,
      date: typeof routeData.routeDate === 'string' ? routeData.routeDate : routeSnapshot.id,
      status: routeData.status === 'completed' ? 'completed' as const : 'active' as const,
      deliveries,
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
    status: routeData.status === 'completed' ? 'completed' : 'active',
    deliveries: deliveriesSnapshot.docs.map((deliverySnapshot) => {
      const deliveryData = deliverySnapshot.data();
      const status = deliveryData.status;
      return {
        id: deliverySnapshot.id,
        address: typeof deliveryData.address === 'string' ? deliveryData.address : '',
        sequence: typeof deliveryData.sequence === 'number' ? deliveryData.sequence : 0,
        status: status === 'delivered' || status === 'failed' ? status : 'pending',
        failureReason: typeof deliveryData.failureReason === 'string' ? deliveryData.failureReason : null,
        proofPhotoUrl: typeof deliveryData.proofPhotoUrl === 'string' ? deliveryData.proofPhotoUrl : null,
      };
    }),
  };
}

export async function addDeliveryToTodayRoute(userId: string, address: string): Promise<Delivery> {
  const firestore = requireDb();
  const routeId = getLocalDateKey();
  const routeRef = getRouteRef(userId, routeId);
  const deliveryRef = doc(collection(routeRef, 'deliveries'));
  const cleanAddress = address.trim();
  if (!cleanAddress || cleanAddress.length > 500) {
    throw new Error('invalid-address');
  }

  const sequence = await runTransaction(firestore, async (transaction) => {
    const routeSnapshot = await transaction.get(routeRef);
    const routeData = routeSnapshot.exists() ? routeSnapshot.data() : null;
    if (routeData?.status === 'completed') throw new Error('route-completed');

    const currentCount = typeof routeData?.stopCount === 'number' ? routeData.stopCount : 0;
    const nextSequence = typeof routeData?.nextSequence === 'number'
      ? routeData.nextSequence
      : currentCount + 1;
    const routeDate = routeId;
    const timestamp = serverTimestamp();

    transaction.set(routeRef, {
      ownerId: userId,
      routeDate,
      status: 'active',
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
      sequence: nextSequence,
      status: 'pending',
      failureReason: null,
      proofPhotoUrl: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveredAt: null,
    });

    return nextSequence;
  });

  return {
    id: deliveryRef.id,
    address: cleanAddress,
    sequence,
    status: 'pending',
    failureReason: null,
    proofPhotoUrl: null,
  };
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
