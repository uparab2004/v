import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { ShoppingBasket, Plus, LogIn } from 'lucide-react-native';
import { useHousehold } from '@/contexts/HouseholdContext';
import { colors, fontFamily, spacing, radius } from '@/lib/theme';

type Mode = 'home' | 'create' | 'join';

export default function OnboardingScreen() {
  const { createHousehold, joinHousehold, errorMessage, clearError, retryIdentity } = useHousehold();
  const [mode, setMode] = useState<Mode>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    await createHousehold(name.trim());
    setSubmitting(false);
  };

  const handleJoin = async () => {
    if (!name.trim() || code.trim().length !== 6) return;
    setSubmitting(true);
    await joinHousehold(code.trim().toUpperCase(), name.trim());
    setSubmitting(false);
  };

  const switchMode = (m: Mode) => {
    clearError();
    setMode(m);
  };

  if (mode === 'home') {
    return (
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logoCircle}>
            <ShoppingBasket color={colors.primary[600]} size={48} strokeWidth={2} />
          </View>
          <Text style={styles.title}>قائمة العائلة</Text>
          <Text style={styles.subtitle}>قائمة تسوق مشتركة لعائلتك</Text>
        </View>

        <View style={styles.actions}>
          {errorMessage && (
            <>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={retryIdentity}>
                <Text style={styles.retryButtonText}>إعادة المحاولة</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.primaryButton} onPress={() => switchMode('create')}>
            <Plus color="#fff" size={22} strokeWidth={2.5} />
            <Text style={styles.primaryButtonText}>إنشاء عائلة جديدة</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => switchMode('join')}>
            <LogIn color={colors.primary[600]} size={22} strokeWidth={2.5} />
            <Text style={styles.secondaryButtonText}>الانضمام لعائلة</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          <Text style={styles.formTitle}>
            {mode === 'create' ? 'إنشاء عائلة جديدة' : 'الانضمام لعائلة'}
          </Text>
          <Text style={styles.formSubtitle}>
            {mode === 'create'
              ? 'أدخل اسمك لتصبح مدير العائلة'
              : 'أدخل اسمك ورمز العائلة للانضمام'}
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>الاسم</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="مثال: أحمد"
              placeholderTextColor={colors.neutral[400]}
              textAlign="right"
            />
          </View>

          {mode === 'join' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>رمز العائلة</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="ABC123"
                placeholderTextColor={colors.neutral[400]}
                maxLength={6}
                autoCapitalize="characters"
                textAlign="center"
              />
            </View>
          )}

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              styles.fullWidth,
              (submitting || !name.trim() || (mode === 'join' && code.trim().length !== 6)) &&
                styles.disabledButton,
            ]}
            onPress={mode === 'create' ? handleCreate : handleJoin}
            disabled={submitting || !name.trim() || (mode === 'join' && code.trim().length !== 6)}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === 'create' ? 'إنشاء' : 'طلب الانضمام'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backLink} onPress={() => switchMode('home')}>
            <Text style={styles.backLinkText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: colors.neutral[50],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing(4),
  },
  hero: { alignItems: 'center', marginBottom: spacing(8) },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing(4),
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 32,
    color: colors.neutral[900],
    marginBottom: spacing(1),
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.neutral[500],
  },
  actions: { width: '100%', maxWidth: 360, gap: spacing(3) },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: colors.primary[600],
    paddingVertical: spacing(4),
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 360,
  },
  primaryButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: '#fff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: colors.primary[50],
    borderWidth: 2,
    borderColor: colors.primary[200],
    paddingVertical: spacing(4),
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 360,
  },
  secondaryButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: colors.primary[600],
  },
  retryButton: {
    alignSelf: 'center',
    paddingVertical: spacing(1),
  },
  retryButtonText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: colors.primary[700],
  },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  formContainer: {
    paddingHorizontal: spacing(5),
    paddingVertical: spacing(6),
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  formTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    color: colors.neutral[900],
    textAlign: 'center',
    marginBottom: spacing(1),
  },
  formSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.neutral[500],
    textAlign: 'center',
    marginBottom: spacing(6),
  },
  inputGroup: { marginBottom: spacing(4) },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: colors.neutral[700],
    marginBottom: spacing(2),
  },
  input: {
    fontFamily: fontFamily.regular,
    fontSize: 17,
    backgroundColor: colors.neutral[0],
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.neutral[900],
  },
  codeInput: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    letterSpacing: 6,
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
    marginBottom: spacing(3),
  },
  fullWidth: { width: '100%', maxWidth: '100%' },
  disabledButton: { opacity: 0.5 },
  backLink: { alignItems: 'center', marginTop: spacing(4) },
  backLinkText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: colors.neutral[500],
  },
});
