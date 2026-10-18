import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { Delivery } from './route-repository';

const CATEGORY = 'connectRouteStop';
const CHANNEL_ID = 'connect-route-high-v2';
const NOTICE_ID_KEY = '@connect/route-notification-id';
let notificationHandlerConfigured = false;

export const ROUTE_NOTIFICATION_ACTIONS = {
  delivered: 'route-stop-delivered',
  failed: 'route-stop-failed',
  open: 'route-open-app',
} as const;

async function loadNotifications() {
  // Expo Go on Android throws when expo-notifications initializes its remote-push token listener.
  // Defer system notifications there so the rest of Connect remains available for testing.
  if (isRunningInExpoGo()) return null;
  const notifications = await import('expo-notifications');
  if (!notificationHandlerConfigured) {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerConfigured = true;
  }
  return notifications;
}

export async function prepareRouteNotifications(): Promise<boolean> {
  if (isRunningInExpoGo()) return true;
  const notifications = await loadNotifications();
  if (!notifications) return true;

  if (Platform.OS === 'android') {
    // Use a new channel ID so Android applies the higher importance to existing installs.
    await notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Ruta en curso',
      description: 'Parada actual y acciones rápidas de Connect',
      importance: notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120],
      lightColor: '#315E43',
    });
  }

  await notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: ROUTE_NOTIFICATION_ACTIONS.delivered, buttonTitle: 'Entregado', options: { opensAppToForeground: true } },
    { identifier: ROUTE_NOTIFICATION_ACTIONS.failed, buttonTitle: 'Fallida', options: { isDestructive: true, opensAppToForeground: true } },
    { identifier: ROUTE_NOTIFICATION_ACTIONS.open, buttonTitle: '↩ Volver a Connect', options: { opensAppToForeground: true } },
  ]);

  const current = await notifications.getPermissionsAsync();
  const permission = current.granted ? current : await notifications.requestPermissionsAsync();
  return permission.granted;
}

export async function showNextStopNotification(stop: Delivery | null): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications) return;
  const oldId = await AsyncStorage.getItem(NOTICE_ID_KEY);
  if (oldId) await notifications.dismissNotificationAsync(oldId).catch(() => undefined);
  await AsyncStorage.removeItem(NOTICE_ID_KEY);
  if (!stop) return;
  const permission = await notifications.getPermissionsAsync();
  if (!permission.granted) return;

  const id = await notifications.scheduleNotificationAsync({
    content: {
      title: `Siguiente parada · ${stop.displayNumber}`,
      body: stop.address,
      data: { stopId: stop.id, displayNumber: stop.displayNumber, url: 'connect:///ruta' },
      categoryIdentifier: CATEGORY,
      sticky: Platform.OS === 'android',
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID, priority: 'high' as const } : {}),
    },
    trigger: null,
  });
  await AsyncStorage.setItem(NOTICE_ID_KEY, id);
}

export async function clearNextStopNotification(): Promise<void> {
  await showNextStopNotification(null);
}
