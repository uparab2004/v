import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const DEVICE_ID_KEY = 'device_user_id';

export async function getOrCreateUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user) {
    return session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw error ?? new Error('تعذر إنشاء هوية آمنة للجهاز');
  }

  await AsyncStorage.removeItem(DEVICE_ID_KEY);
  return data.user.id;
}
