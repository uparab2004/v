import { supabase } from './supabase';

const SAUDI_COUNTRY_CODE = '+966';

export function normalizeSaudiPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('966')) return `+${digits}`;
  if (digits.startsWith('0')) return `${SAUDI_COUNTRY_CODE}${digits.slice(1)}`;
  return `${SAUDI_COUNTRY_CODE}${digits}`;
}

export function isSaudiPhone(value: string) {
  return /^\+9665\d{8}$/.test(normalizeSaudiPhone(value));
}

export async function sendWhatsAppCode(phone: string) {
  const normalizedPhone = normalizeSaudiPhone(phone);
  if (!isSaudiPhone(normalizedPhone)) {
    return { error: 'أدخل رقم جوال سعودي صحيحًا.' };
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone: normalizedPhone,
    options: { channel: 'whatsapp' },
  });

  return { error: error ? 'تعذر إرسال رمز التحقق. حاول مرة أخرى.' : null, phone: normalizedPhone };
}

export async function verifyWhatsAppCode(phone: string, code: string) {
  const token = code.replace(/\D/g, '');
  if (!/^\d{6}$/.test(token)) {
    return { error: 'أدخل رمز التحقق المكوّن من 6 أرقام.' };
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalizeSaudiPhone(phone),
    token,
    type: 'sms',
  });

  return { error: error ? 'رمز التحقق غير صحيح أو انتهت صلاحيته.' : null, session: data.session };
}
