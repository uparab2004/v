import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Crown, UserCheck, UserX, LogOut, Clock, Plus, LogIn } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useHousehold } from '@/contexts/HouseholdContext';
import { HouseholdMember } from '@/lib/types';
import { colors, fontFamily, spacing, radius } from '@/lib/theme';

export default function MembersScreen() {
  const { household, member, members, households, switchHousehold, respondToRequest, leaveHousehold, errorMessage } =
    useHousehold();
  const router = useRouter();

  const approvedMembers = members.filter((m) => m.status === 'approved');
  const pendingMembers = members.filter((m) => m.status === 'pending');
  const isAdmin = member?.is_admin ?? false;

  const getInitials = (name: string) => (name ? name.charAt(0) : '؟');

  const handleRespond = (m: HouseholdMember, approve: boolean) => {
    respondToRequest(m.id, approve);
  };

  const handleLeave = () => {
    Alert.alert(
      'مغادرة العائلة',
      'هل أنت متأكد من مغادرة هذه العائلة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'مغادرة', style: 'destructive', onPress: leaveHousehold },
      ],
    );
  };

  const renderMember = (m: HouseholdMember) => {
    const isMe = m.user_id === member?.user_id;
    return (
      <View key={m.id} style={styles.memberCard}>
        <View style={[styles.avatar, m.is_admin && styles.adminAvatar]}>
          <Text style={[styles.avatarText, m.is_admin && styles.adminAvatarText]}>
            {getInitials(m.name)}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.memberName}>
              {m.name} {isMe && <Text style={styles.meTag}>(أنت)</Text>}
            </Text>
            {m.is_admin && (
              <View style={styles.adminBadge}>
                <Crown color={colors.accent[600]} size={14} strokeWidth={2.5} />
                <Text style={styles.adminBadgeText}>مدير</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderPending = (m: HouseholdMember) => (
    <View key={m.id} style={styles.pendingCard}>
      <View style={styles.pendingLeft}>
        <View style={styles.pendingAvatar}>
          <Text style={styles.pendingAvatarText}>{getInitials(m.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingName}>{m.name}</Text>
          <View style={styles.pendingStatusRow}>
            <Clock color={colors.accent[500]} size={13} strokeWidth={2} />
            <Text style={styles.pendingStatus}>بانتظار الموافقة</Text>
          </View>
        </View>
      </View>
      <View style={styles.pendingActions}>
        <TouchableOpacity
          style={styles.approveBtn}
          onPress={() => handleRespond(m, true)}
        >
          <UserCheck color="#fff" size={18} strokeWidth={2.5} />
          <Text style={styles.approveText}>قبول</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rejectBtn}
          onPress={() => handleRespond(m, false)}
        >
          <UserX color={colors.error[600]} size={18} strokeWidth={2.5} />
          <Text style={styles.rejectText}>رفض</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>أعضاء العائلة</Text>
        {household && (
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeLabel}>الرمز</Text>
            <Text style={styles.codeBadgeText}>{household.code}</Text>
          </View>
        )}
      </View>

      {errorMessage && (
        <Text style={styles.errorBanner}>{errorMessage}</Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>عائلاتي ({households.length})</Text>
        {households.map((option) => (
          <TouchableOpacity
            key={option.id}
            style={[styles.householdOption, option.id === household?.id && styles.householdOptionActive]}
            onPress={() => switchHousehold(option.id)}
          >
            <View>
              <Text style={styles.householdOptionCode}>{option.name}</Text>
              <Text style={styles.householdOptionStatus}>
                {option.member.status === 'approved' ? `رمز الانضمام: ${option.code}` : 'طلب بانتظار الموافقة'}
              </Text>
            </View>
            {option.id === household?.id && <Text style={styles.activeLabel}>العائلة الحالية</Text>}
          </TouchableOpacity>
        ))}
        <View style={styles.familyActions}>
          <TouchableOpacity style={styles.familyAction} onPress={() => router.push('/?mode=create')}>
            <Plus color={colors.primary[700]} size={18} strokeWidth={2.5} />
            <Text style={styles.familyActionText}>إنشاء عائلة</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.familyAction} onPress={() => router.push('/?mode=join')}>
            <LogIn color={colors.primary[700]} size={18} strokeWidth={2.5} />
            <Text style={styles.familyActionText}>انضمام لعائلة</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isAdmin && pendingMembers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            طلبات الانضمام ({pendingMembers.length})
          </Text>
          {pendingMembers.map(renderPending)}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          الأعضاء ({approvedMembers.length})
        </Text>
        {approvedMembers.map(renderMember)}
      </View>

      <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
        <LogOut color={colors.error[600]} size={18} strokeWidth={2} />
        <Text style={styles.leaveText}>
          مغادرة العائلة
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  scrollContent: {
    paddingHorizontal: spacing(4),
    paddingTop: spacing(6),
    paddingBottom: spacing(10),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing(5),
  },
  headerTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    color: colors.neutral[900],
  },
  codeBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  codeBadgeLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: colors.primary[600],
  },
  codeBadgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: colors.primary[700],
    letterSpacing: 2,
  },
  errorBanner: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
    paddingVertical: spacing(2),
    marginBottom: spacing(3),
    backgroundColor: colors.error[100],
    borderRadius: radius.sm,
  },
  section: { marginBottom: spacing(6) },
  householdOption: {
    backgroundColor: colors.neutral[0], borderRadius: radius.md, padding: spacing(3),
    marginBottom: spacing(2), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.neutral[200],
  },
  householdOptionActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  householdOptionCode: { fontFamily: fontFamily.bold, fontSize: 17, color: colors.neutral[900], letterSpacing: 1.5 },
  householdOptionStatus: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.neutral[500], marginTop: 2 },
  activeLabel: { fontFamily: fontFamily.medium, fontSize: 12, color: colors.primary[700] },
  familyActions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(1) },
  familyAction: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing(1),
    borderWidth: 1, borderColor: colors.primary[300], borderRadius: radius.sm, paddingVertical: spacing(2),
  },
  familyActionText: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.primary[700] },
  sectionTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: colors.neutral[600],
    marginBottom: spacing(3),
    paddingHorizontal: spacing(1),
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[0],
    borderRadius: radius.md,
    padding: spacing(3.5),
    marginBottom: spacing(2),
    gap: spacing(3),
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminAvatar: {
    backgroundColor: colors.accent[500],
  },
  avatarText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: colors.primary[700],
  },
  adminAvatarText: {
    color: '#fff',
  },
  memberInfo: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
  },
  memberName: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    color: colors.neutral[900],
  },
  meTag: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.neutral[400],
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    backgroundColor: colors.accent[500] + '22',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: radius.sm,
  },
  adminBadgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    color: colors.accent[600],
  },
  pendingCard: {
    backgroundColor: colors.warning[100],
    borderRadius: radius.md,
    padding: spacing(3.5),
    marginBottom: spacing(2),
  },
  pendingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    marginBottom: spacing(3),
  },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.neutral[0],
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingAvatarText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: colors.neutral[700],
  },
  pendingName: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: colors.neutral[900],
    marginBottom: spacing(1),
  },
  pendingStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
  },
  pendingStatus: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.accent[600],
  },
  pendingActions: {
    flexDirection: 'row',
    gap: spacing(2),
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(1.5),
    backgroundColor: colors.primary[600],
    paddingVertical: spacing(2.5),
    borderRadius: radius.sm,
  },
  approveText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: '#fff',
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(1.5),
    backgroundColor: colors.neutral[0],
    borderWidth: 1.5,
    borderColor: colors.error[500],
    paddingVertical: spacing(2.5),
    borderRadius: radius.sm,
  },
  rejectText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.error[600],
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    paddingVertical: spacing(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.error[100],
    marginTop: spacing(4),
  },
  leaveText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: colors.error[600],
  },
});
