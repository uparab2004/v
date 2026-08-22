import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { Clock, X } from 'lucide-react-native';
import { useHousehold } from '@/contexts/HouseholdContext';
import { colors, fontFamily, spacing, radius } from '@/lib/theme';

export default function PendingScreen() {
  const { phase, household, member, errorMessage, leaveHousehold } = useHousehold();

  if (phase === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary[600]} />
      </View>
    );
  }

  // A failed or reset identity must never leave this route displaying an
  // empty household code and member name.
  if (phase === 'onboarding') {
    return <Redirect href="/" />;
  }

  if (phase === 'rejected') {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={[styles.iconCircle, styles.rejectedIcon]}>
            <X color={colors.error[600]} size={40} strokeWidth={2.5} />
          </View>
          <Text style={styles.cardTitle}>تم رفض طلبك</Text>
          <Text style={styles.cardSubtitle}>
            لم تتم الموافقة على انضمامك لهذه العائلة. يمكنك المحاولة مرة أخرى.
          </Text>
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          <LeaveButton onLeave={leaveHousehold} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Clock color={colors.primary[600]} size={40} strokeWidth={2.5} />
        </View>
        <Text style={styles.cardTitle}>بانتظار الموافقة</Text>
        <Text style={styles.cardSubtitle}>
          تم إرسال طلب انضمامك لعائلة برمز{'\n'}
          <Text style={styles.codeText}>{household?.code ?? '------'}</Text>
          {'\n\n'}بانتظار موافقة مدير العائلة.
        </Text>
        <Text style={styles.memberName}>الاسم: {member?.name}</Text>
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        <LeaveButton onLeave={leaveHousehold} label="إلغاء الطلب" />
      </View>
    </View>
  );
}

function LeaveButton({ onLeave, label = 'رجوع' }: { onLeave: () => void; label?: string }) {
  return (
    <Text
      onPress={onLeave}
      style={styles.leaveButton}
      accessibilityRole="button"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
    paddingHorizontal: spacing(5),
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: radius.lg,
    padding: spacing(7),
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing(5),
  },
  rejectedIcon: { backgroundColor: colors.error[100] },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    color: colors.neutral[900],
    marginBottom: spacing(2),
  },
  cardSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.neutral[500],
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: spacing(3),
  },
  codeText: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    color: colors.primary[600],
    letterSpacing: 4,
  },
  memberName: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: colors.neutral[600],
    marginBottom: spacing(4),
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
    marginBottom: spacing(3),
  },
  leaveButton: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: colors.neutral[500],
    marginTop: spacing(2),
    paddingVertical: spacing(2),
  },
});
