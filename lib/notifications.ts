import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function enablePushNotifications(userId: string) {
  if (!Device.isDevice) {
    return { error: 'تعمل الإشعارات على جهاز حقيقي فقط.' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('maqadhi', {
      name: 'إشعارات مقاضي',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted'
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') {
    return { error: 'لم يتم السماح بالإشعارات.' };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { error: 'تعذر تجهيز إشعارات هذا التطبيق.' };
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.from('maqadhi_v2_push_tokens').upsert({
      user_id: userId,
      expo_token: token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'expo_token' });
    return { error: error ? 'تعذر حفظ إعداد الإشعارات.' : null };
  } catch {
    return { error: 'تعذر تجهيز الإشعارات. تحقق من اتصال الإنترنت.' };
  }
}
