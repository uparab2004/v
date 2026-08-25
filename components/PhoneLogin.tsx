import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { sendWhatsAppCode, verifyWhatsAppCode } from '../lib/phoneAuth';
import { supabase } from '../lib/supabase';

type PhoneLoginProps = { onAuthenticated: () => void };

export function PhoneLogin({ onAuthenticated }: PhoneLoginProps) {
  const [step, setStep] = useState<'phone' | 'code' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setLoading(true);
    setMessage('');
    const result = await sendWhatsAppCode(phone);
    setLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setPhone(result.phone ?? phone);
    setStep('code');
    setMessage('أرسلنا رمز التحقق إلى واتساب.');
  };

  const verifyCode = async () => {
    setLoading(true);
    setMessage('');
    const result = await verifyWhatsAppCode(phone, code);
    setLoading(false);
    if (result.error || !result.session) {
      setMessage(result.error ?? 'تعذر التحقق من الرمز.');
      return;
    }
    const displayName = result.session.user.user_metadata?.display_name;
    if (typeof displayName === 'string' && displayName.trim()) {
      onAuthenticated();
      return;
    }
    setStep('name');
  };

  const saveName = async () => {
    const displayName = name.trim();
    if (!displayName) {
      setMessage('اكتب اسمك أولًا.');
      return;
    }
    setLoading(true);
    setMessage('');
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
    setLoading(false);
    if (error) {
      setMessage('تعذر حفظ الاسم. حاول مرة أخرى.');
      return;
    }
    onAuthenticated();
  };

  const title = step === 'phone' ? 'تسجيل الدخول' : step === 'code' ? 'تأكيد الرقم' : 'اكتب اسمك';
  const description = step === 'phone'
    ? 'أدخل رقم جوالك لإرسال رمز التحقق عبر واتساب.'
    : step === 'code'
      ? 'أدخل رمز التحقق المكوّن من 6 أرقام.'
      : 'هذا الاسم سيظهر لأعضاء مجموعاتك.';

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {step === 'phone' && <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="05xxxxxxxx" placeholderTextColor="#9ca3af" style={styles.input} textAlign="right" />}
        {step === 'code' && <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="000000" placeholderTextColor="#9ca3af" style={[styles.input, styles.codeInput]} textAlign="center" />}
        {step === 'name' && <TextInput value={name} onChangeText={setName} placeholder="الاسم" placeholderTextColor="#9ca3af" style={styles.input} textAlign="right" />}
        {!!message && <Text style={styles.message}>{message}</Text>}
        <TouchableOpacity disabled={loading} style={[styles.button, loading && styles.buttonDisabled]} onPress={step === 'phone' ? sendCode : step === 'code' ? verifyCode : saveName}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{step === 'phone' ? 'إرسال الرمز عبر واتساب' : step === 'code' ? 'تأكيد الرمز' : 'حفظ والمتابعة'}</Text>}
        </TouchableOpacity>
        {step === 'code' && <TouchableOpacity disabled={loading} onPress={() => setStep('phone')}><Text style={styles.back}>تغيير الرقم</Text></TouchableOpacity>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fafafa', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 28, gap: 16, elevation: 2 },
  title: { color: '#171717', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  description: { color: '#6b7280', fontSize: 16, lineHeight: 26, textAlign: 'center' },
  input: { borderColor: '#d1d5db', borderRadius: 14, borderWidth: 1, color: '#171717', fontSize: 18, minHeight: 58, paddingHorizontal: 16 },
  codeInput: { fontSize: 24, letterSpacing: 8 },
  button: { alignItems: 'center', backgroundColor: '#159447', borderRadius: 14, minHeight: 56, justifyContent: 'center' },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  message: { color: '#a34a43', fontSize: 14, textAlign: 'center' },
  back: { color: '#159447', fontSize: 15, fontWeight: '700', paddingTop: 4, textAlign: 'center' },
});
