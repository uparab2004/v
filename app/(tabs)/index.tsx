import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Plus, Check, RotateCcw, Trash2, ChevronDown } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useHousehold } from '@/contexts/HouseholdContext';
import { ShoppingItem, HouseholdMember } from '@/lib/types';
import { colors, fontFamily, spacing, radius } from '@/lib/theme';

export default function ListScreen() {
  const { household, member, members, households, switchHousehold, errorMessage, clearError } = useHousehold();
  const router = useRouter();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showGroups, setShowGroups] = useState(false);

  const membersById = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const loadItems = useCallback(async () => {
    if (!household) return;
    const { data, error } = await supabase
      .from('shopping_items')
      .select('*')
      .eq('household_id', household.id)
      .order('is_purchased', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('load items failed', error);
      return;
    }
    setItems((data ?? []) as ShoppingItem[]);
    setLoading(false);
  }, [household]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!household) return;

    const channel = supabase
      .channel(`shopping-items-${household.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'maqadhi',
          table: 'shopping_items',
          filter: `household_id=eq.${household.id}`,
        },
        () => loadItems(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [household?.id, loadItems]);

  const addItem = async () => {
    if (!newItem.trim() || !household || !member) return;
    setAdding(true);
    clearError();
    const { error } = await supabase.from('shopping_items').insert({
      household_id: household.id,
      name: newItem.trim(),
      created_by: member.user_id,
    });
    if (error) {
      console.error('add item failed', error);
    }
    setNewItem('');
    setAdding(false);
  };

  const togglePurchased = async (item: ShoppingItem) => {
    if (!member) return;
    if (item.is_purchased) {
      // Restore
      const { error } = await supabase
        .from('shopping_items')
        .update({
          is_purchased: false,
          purchased_by: null,
          purchased_at: null,
        })
        .eq('id', item.id);
      if (error) console.error('restore item failed', error);
    } else {
      // Mark purchased
      const { error } = await supabase
        .from('shopping_items')
        .update({
          is_purchased: true,
          purchased_by: member.user_id,
          purchased_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) console.error('purchase item failed', error);
    }
  };

  const deleteItem = async (item: ShoppingItem) => {
    const { error } = await supabase.from('shopping_items').delete().eq('id', item.id);
    if (error) console.error('delete item failed', error);
  };

  const activeItems = items.filter((i) => !i.is_purchased);
  const purchasedItems = items.filter((i) => i.is_purchased);

  const getMemberName = (userId: string | null) => {
    if (!userId) return '';
    return membersById.get(userId)?.name ?? '';
  };

  const getInitials = (name: string) => {
    if (!name) return '؟';
    return name.charAt(0);
  };

  const renderItem = ({ item }: { item: ShoppingItem }) => {
    const creatorName = getMemberName(item.created_by);
    const buyerName = getMemberName(item.purchased_by);
    const displayName = item.is_purchased ? buyerName : creatorName;

    return (
      <View style={[styles.itemRow, item.is_purchased && styles.purchasedRow]}>
        <TouchableOpacity
          style={styles.itemCheck}
          onPress={() => togglePurchased(item)}
          activeOpacity={0.7}
        >
          {item.is_purchased ? (
            <View style={styles.checkedCircle}>
              <Check color="#fff" size={16} strokeWidth={3} />
            </View>
          ) : (
            <View style={styles.uncheckedCircle} />
          )}
        </TouchableOpacity>

        <View style={styles.itemContent}>
          <Text
            style={[styles.itemName, item.is_purchased && styles.purchasedText]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          {displayName ? (
            <View style={styles.memberTag}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
              </View>
              <Text style={styles.memberNameText}>{displayName}</Text>
            </View>
          ) : null}
        </View>

        {item.is_purchased && (
          <TouchableOpacity style={styles.restoreBtn} onPress={() => togglePurchased(item)}>
            <RotateCcw color={colors.primary[600]} size={18} strokeWidth={2} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteItem(item)}>
          <Trash2 color={colors.neutral[400]} size={16} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color={colors.primary[600]} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.groupTrigger} onPress={() => setShowGroups((visible) => !visible)}>
          <ChevronDown color={colors.primary[700]} size={18} strokeWidth={2.5} />
          <View>
            <Text style={styles.groupTriggerLabel}>المجموعة الحالية</Text>
            <Text style={styles.groupTriggerName}>{household?.name ?? 'العائلة'}</Text>
          </View>
        </TouchableOpacity>
        {household && (
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>{household.code}</Text>
          </View>
        )}
      </View>

      {showGroups && (
        <View style={styles.groupsPanel}>
          <Text style={styles.groupsTitle}>مجموعاتي</Text>
          {households.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[styles.groupRow, option.id === household?.id && styles.groupRowActive]}
              onPress={async () => { await switchHousehold(option.id); setShowGroups(false); }}
            >
              <Text style={styles.groupRowName}>{option.name}</Text>
              <Text style={styles.groupRowCode}>{option.code}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.groupsActions}>
            <TouchableOpacity onPress={() => router.push('/?mode=join')}><Text style={styles.groupsLink}>+ الانضمام لعائلة أخرى</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/?mode=create')}><Text style={styles.groupsLink}>+ إنشاء عائلة جديدة</Text></TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={newItem}
          onChangeText={setNewItem}
          placeholder="أضف عنصراً... (مثال: حليب ٢ لتر)"
          placeholderTextColor={colors.neutral[400]}
          textAlign="right"
          onSubmitEditing={addItem}
        />
        <TouchableOpacity
          style={[styles.addButton, (!newItem.trim() || adding) && styles.addButtonDisabled]}
          onPress={addItem}
          disabled={!newItem.trim() || adding}
        >
          {adding ? (
            <ActivityIndicator color="#fff" size={20} />
          ) : (
            <Plus color="#fff" size={22} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>

      {errorMessage && (
        <Text style={styles.errorBanner}>{errorMessage}</Text>
      )}

      <FlatList
        data={[...activeItems, ...purchasedItems]}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>القائمة فارغة</Text>
            <Text style={styles.emptySubtitle}>أضف أول عنصر باستخدام الحقل في الأعلى</Text>
          </View>
        }
        ListFooterComponent={
          purchasedItems.length > 0 ? (
            <View style={styles.sectionLabel}>
              <Text style={styles.sectionLabelText}>
                المشتريات ({purchasedItems.length})
              </Text>
            </View>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  centerScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    paddingTop: spacing(6),
    paddingBottom: spacing(2),
    backgroundColor: colors.neutral[0],
  },
  groupTrigger: { flexDirection: 'row', alignItems: 'center', gap: spacing(1), flex: 1 },
  groupTriggerLabel: { fontFamily: fontFamily.regular, fontSize: 11, color: colors.neutral[500] },
  groupTriggerName: { fontFamily: fontFamily.bold, fontSize: 20, color: colors.neutral[900] },
  groupsPanel: { marginHorizontal: spacing(4), marginBottom: spacing(3), backgroundColor: colors.neutral[0], borderRadius: radius.md, padding: spacing(3), borderWidth: 1, borderColor: colors.neutral[200] },
  groupsTitle: { fontFamily: fontFamily.bold, fontSize: 16, color: colors.neutral[800], marginBottom: spacing(2) },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing(2), paddingHorizontal: spacing(2), borderRadius: radius.sm },
  groupRowActive: { backgroundColor: colors.primary[50] },
  groupRowName: { fontFamily: fontFamily.medium, fontSize: 16, color: colors.neutral[900] },
  groupRowCode: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.primary[700], letterSpacing: 1 },
  groupsActions: { marginTop: spacing(2), paddingTop: spacing(2), borderTopWidth: 1, borderTopColor: colors.neutral[200], gap: spacing(2) },
  groupsLink: { fontFamily: fontFamily.medium, fontSize: 14, color: colors.primary[700] },
  headerTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    color: colors.neutral[900],
  },
  codeBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
    borderRadius: radius.sm,
  },
  codeBadgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: colors.primary[700],
    letterSpacing: 2,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    backgroundColor: colors.neutral[0],
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
    gap: spacing(2),
  },
  textInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    backgroundColor: colors.neutral[50],
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    color: colors.neutral[900],
  },
  addButton: {
    backgroundColor: colors.primary[600],
    width: 48,
    height: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: { opacity: 0.4 },
  errorBanner: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
    paddingVertical: spacing(2),
    backgroundColor: colors.error[100],
  },
  listContent: {
    paddingHorizontal: spacing(3),
    paddingTop: spacing(3),
    paddingBottom: spacing(10),
  },
  separator: { height: 1, backgroundColor: colors.neutral[100], marginHorizontal: spacing(2) },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[0],
    borderRadius: radius.md,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(3),
    gap: spacing(2),
  },
  purchasedRow: {
    opacity: 0.55,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderStyle: 'dashed',
  },
  itemCheck: { padding: spacing(1) },
  uncheckedCircle: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.neutral[300],
  },
  checkedCircle: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.primary[600],
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemContent: { flex: 1 },
  itemName: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: colors.neutral[900],
    marginBottom: spacing(1),
  },
  purchasedText: {
    textDecorationLine: 'line-through',
    color: colors.neutral[500],
  },
  memberTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.primary[200],
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    color: colors.primary[800],
  },
  memberNameText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.neutral[500],
  },
  restoreBtn: { padding: spacing(1.5) },
  deleteBtn: { padding: spacing(1.5) },
  sectionLabel: {
    marginTop: spacing(4),
    marginBottom: spacing(2),
    paddingHorizontal: spacing(2),
  },
  sectionLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: colors.neutral[500],
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing(12),
  },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    color: colors.neutral[400],
    marginBottom: spacing(2),
  },
  emptySubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.neutral[400],
  },
});
