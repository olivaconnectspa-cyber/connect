import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { setNotificationCategoryAsync } from 'expo-notifications/build/setNotificationCategoryAsync';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { dismissNotificationAsync } from 'expo-notifications/build/dismissNotificationAsync';
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
import type { Delivery } from './route-repository';

const CATEGORY = 'connectRouteStop';
const NOTICE_ID_KEY = '@connect/route-notification-id';
export const ROUTE_NOTIFICATION_ACTIONS = {
  delivered: 'route-stop-delivered',
  failed: 'route-stop-failed',
  open: 'route-open-app',
} as const;

export async function prepareRouteNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await setNotificationChannelAsync('route', {
      name: 'Ruta en curso',
      description: 'Parada actual y acciones rápidas de Connect',
      importance: 3,
      vibrationPattern: [0, 120],
      lightColor: '#315E43',
    });
  }

  await setNotificationCategoryAsync(CATEGORY, [
    { identifier: ROUTE_NOTIFICATION_ACTIONS.delivered, buttonTitle: 'Entregado', options: { opensAppToForeground: true } },
    { identifier: ROUTE_NOTIFICATION_ACTIONS.failed, buttonTitle: 'Fallida', options: { isDestructive: true, opensAppToForeground: true } },
    { identifier: ROUTE_NOTIFICATION_ACTIONS.open, buttonTitle: '↩ Volver a Connect', options: { opensAppToForeground: true } },
  ]);

  const current = await getPermissionsAsync();
  const permission = current.granted ? current : await requestPermissionsAsync();
  return permission.granted;
}

export async function showNextStopNotification(stop: Delivery | null): Promise<void> {
  const oldId = await AsyncStorage.getItem(NOTICE_ID_KEY);
  if (oldId) await dismissNotificationAsync(oldId).catch(() => undefined);
  await AsyncStorage.removeItem(NOTICE_ID_KEY);
  if (!stop) return;
  const permission = await getPermissionsAsync();
  if (!permission.granted) return;

  const id = await scheduleNotificationAsync({
    content: {
      title: `Siguiente parada · ${stop.displayNumber}`,
      body: stop.address,
      data: { stopId: stop.id, displayNumber: stop.displayNumber, url: 'connect:///ruta' },
      categoryIdentifier: CATEGORY,
      sticky: Platform.OS === 'android',
      sound: false,
      ...(Platform.OS === 'android' ? { channelId: 'route', priority: 'default' } : {}),
    },
    trigger: null,
  });
  await AsyncStorage.setItem(NOTICE_ID_KEY, id);
}

export async function clearNextStopNotification(): Promise<void> {
  await showNextStopNotification(null);
}

setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
