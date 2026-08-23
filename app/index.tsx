import { useRef, useState } from 'react';
import {
  I18nManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, Clipboard, LogOut, Minus, Pencil, Plus, Users, X } from 'lucide-react-native';

I18nManager.allowRTL(true);

type Item = {
  id: string;
  name: string;
  quantity: number;
  addedBy: string;
  purchasedBy?: string;
  purchased: boolean;
};

type Group = { id: string; name: string; code: string; members: string[]; pending: string[]; manager: string };

const initialItems: Item[] = [
  { id: '1', name: 'بطاطس', quantity: 2, addedBy: 'محمود', purchased: false },
  { id: '2', name: 'بصل', quantity: 1, addedBy: 'أبو المثنى', purchased: false },
  { id: '3', name: 'حليب', quantity: 2, addedBy: 'محمود', purchased: true, purchasedBy: 'مازن' },
];

export default function MaqadhiHome() {
  const [groupList, setGroupList] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [newItem, setNewItem] = useState('');
  const [groupsVisible, setGroupsVisible] = useState(false);
  const [requestsVisible, setRequestsVisible] = useState(false);
  const [membersVisible, setMembersVisible] = useState(false);
  const [exitVisible, setExitVisible] = useState(false);
  const [groupAction, setGroupAction] = useState<'create' | 'join' | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<TextInput>(null);

  const addItem = () => {
    const name = newItem.trim();
    if (!name) return;
    setItems((current) => [
      { id: String(Date.now()), name, quantity: 1, addedBy: 'محمود', purchased: false },
      ...current,
    ]);
    setNewItem('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const changeQuantity = (id: string, amount: number) => {
    setItems((current) => current.map((item) =>
      item.id === id ? { ...item, quantity: Math.max(1, item.quantity + amount) } : item,
    ));
  };

  const togglePurchased = (id: string) => {
    setItems((current) => current.map((item) =>
      item.id === id
        ? { ...item, purchased: !item.purchased, purchasedBy: !item.purchased ? 'محمود' : undefined }
        : item,
    ));
  };

  const removeItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  const saveItemName = () => {
    const name = editedName.trim();
    if (!editingId || !name) return;
    setItems((current) => current.map((item) => item.id === editingId ? { ...item, name } : item));
    setEditingId(null);
  };
  const createGroup = () => {
    const name = groupName.trim();
    if (!name) return;
    const group: Group = { id: String(Date.now()), name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), members: ['محمود'], pending: [], manager: 'محمود' };
    setGroupList((current) => [group, ...current]);
    setActiveGroup(group);
    setItems([]);
    setGroupName('');
    setGroupAction(null);
    setGroupsVisible(false);
  };
  const joinGroup = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return;
    const group = groupList.find((entry) => entry.code === code);
    if (!group) {
      setNotice('رمز المجموعة غير صحيح.');
      return;
    }
    if (group.members.includes('محمود')) {
      setActiveGroup(group);
      setNotice('أنت عضو في هذه المجموعة بالفعل.');
    } else if (group.pending.includes('محمود')) {
      setNotice('طلب انضمامك ما زال بانتظار موافقة المدير.');
    } else {
      const updated = { ...group, pending: [...group.pending, 'محمود'] };
      setGroupList((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setNotice('تم إرسال طلب الانضمام إلى مدير المجموعة.');
    }
    setJoinCode('');
    setGroupAction(null);
    setGroupsVisible(false);
  };
  const leaveGroup = (nextManager: string) => {
    if (!activeGroup) return;
    setExitVisible(false);
    const updated = { ...activeGroup, manager: nextManager, members: activeGroup.members.filter((name) => name !== 'محمود') };
    const remaining = groupList.filter((group) => group.id !== updated.id);
    setGroupList(remaining);
    const alternative = remaining[0];
    if (alternative) {
      setActiveGroup(alternative);
      setNotice(`تم تعيين ${nextManager} مديرًا وغادرت المجموعة.`);
    } else {
      setActiveGroup(null);
      setNotice(`تم تعيين ${nextManager} مديرًا وغادرت المجموعة.`);
    }
  };

  const acceptRequest = (name: string) => {
    if (!activeGroup) return;
    const updated = { ...activeGroup, pending: activeGroup.pending.filter((entry) => entry !== name), members: [...activeGroup.members, name] };
    setActiveGroup(updated);
    setGroupList((current) => current.map((group) => group.id === updated.id ? updated : group));
  };

  const rejectRequest = (name: string) => {
    if (!activeGroup) return;
    const updated = { ...activeGroup, pending: activeGroup.pending.filter((entry) => entry !== name) };
    setActiveGroup(updated);
    setGroupList((current) => current.map((group) => group.id === updated.id ? updated : group));
  };

  const share = () => setShareVisible(true);
  const requestedCount = activeGroup?.pending.length ?? 0;
  const wanted = items.filter((item) => !item.purchased);
  const bought = items.filter((item) => item.purchased);

  if (!activeGroup) {
    return (
      <View style={styles.welcomeScreen}>
        <View style={styles.welcomeContent}>
          <Text style={styles.welcomeTitle}>مقاضي</Text>
          <Text style={styles.welcomeText}>أنشئ مجموعة جديدة أو انضم إلى مجموعة برمز الدخول.</Text>
          <TouchableOpacity style={styles.welcomePrimary} onPress={() => setGroupAction('create')}><Text style={styles.welcomePrimaryText}>إنشاء مجموعة</Text></TouchableOpacity>
          <TouchableOpacity style={styles.welcomeSecondary} onPress={() => setGroupAction('join')}><Text style={styles.welcomeSecondaryText}>الانضمام برمز</Text></TouchableOpacity>
        </View>
        <Modal visible={groupAction !== null} transparent animationType="fade" onRequestClose={() => setGroupAction(null)}>
          <Pressable style={styles.overlay} onPress={() => setGroupAction(null)}>
            <Pressable style={styles.sheet} onPress={() => undefined}>
              <Text style={styles.modalTitle}>{groupAction === 'create' ? 'إنشاء مجموعة جديدة' : 'الانضمام لمجموعة'}</Text>
              <TextInput value={groupAction === 'create' ? groupName : joinCode} onChangeText={groupAction === 'create' ? setGroupName : (value) => setJoinCode(value.toUpperCase())} placeholder={groupAction === 'create' ? 'اسم المجموعة' : 'رمز الدخول المكوّن من ٦ خانات'} placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={groupAction === 'join' ? 6 : 80} autoCapitalize="characters" />
              <TouchableOpacity style={styles.primaryModalButton} onPress={groupAction === 'create' ? createGroup : joinGroup}><Text style={styles.primaryModalText}>{groupAction === 'create' ? 'إنشاء المجموعة' : 'انضمام'}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setGroupAction(null)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.groupTrigger} onPress={() => setGroupsVisible(true)}>
            <ChevronDown color={colors.text} size={19} />
            <View>
              <Text style={styles.groupOverline}>المجموعة الحالية</Text>
              <Text style={styles.groupName}>{activeGroup.name}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.topActions}>
            {requestedCount > 0 && (
              <TouchableOpacity style={[styles.roundAction, styles.requestsAction]} onPress={() => setRequestsVisible(true)}>
                <Text style={styles.requestsText}>الطلبات ({requestedCount})</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.roundAction} onPress={() => setMembersVisible(true)}>
              <Users color={colors.muted} size={19} />
              <Text style={styles.actionText}>الأعضاء ({activeGroup.members.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exitAction} onPress={() => setExitVisible(true)}>
              <LogOut color={colors.danger} size={18} />
              <Text style={styles.exitText}>خروج</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.code}>رمز الانضمام: <Text style={styles.codeValue}>{activeGroup.code}</Text></Text>
        {!!notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.addRow}>
          <TouchableOpacity style={styles.addButton} onPress={addItem}>
            <Text style={styles.addButtonText}>إضافة</Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            value={newItem}
            onChangeText={setNewItem}
            onSubmitEditing={addItem}
            returnKeyType="done"
            placeholder="اكتب غرض جديد..."
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            textAlign="right"
          />
        </View>

        <TouchableOpacity style={styles.shareButton} onPress={share}>
          <Clipboard color={colors.primary} size={18} />
          <Text style={styles.shareText}>مشاركة رابط الانضمام للمجموعة</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>اضغط على الغرض لنقله إلى قسم «تم شراؤه»</Text>

        <Text style={styles.sectionTitle}>المطلوب شراؤه ({wanted.length})</Text>
        {wanted.map((item) => (
          <ShoppingRow key={item.id} item={item} onToggle={togglePurchased} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />
        ))}

        {bought.length > 0 && <View style={styles.divider} />}
        {bought.length > 0 && <Text style={styles.sectionTitle}>تم شراؤه ({bought.length})</Text>}
        {bought.map((item) => (
          <ShoppingRow key={item.id} item={item} onToggle={togglePurchased} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />
        ))}
      </ScrollView>

      <Modal visible={groupsVisible} transparent animationType="fade" onRequestClose={() => setGroupsVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setGroupsVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>مجموعاتي</Text>
            {groupList.map((group) => (
              <TouchableOpacity key={group.id} style={[styles.groupOption, group.id === activeGroup.id && styles.activeGroup]} onPress={() => { setActiveGroup(group); setGroupsVisible(false); }}>
                <View><Text style={styles.groupOptionName}>{group.name}</Text><Text style={styles.groupOptionCode}>رمز الانضمام: {group.code}</Text></View>
                {group.id === activeGroup.id && <Check color={colors.primary} size={20} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.primaryModalButton} onPress={() => setGroupAction('join')}><Text style={styles.primaryModalText}>+ الانضمام لمجموعة أخرى</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryModalButton} onPress={() => setGroupAction('create')}><Text style={styles.secondaryModalText}>+ إنشاء مجموعة جديدة</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setGroupsVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={groupAction !== null} transparent animationType="fade" onRequestClose={() => setGroupAction(null)}>
        <Pressable style={styles.overlay} onPress={() => setGroupAction(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>{groupAction === 'create' ? 'إنشاء مجموعة جديدة' : 'الانضمام لمجموعة'}</Text>
            <TextInput value={groupAction === 'create' ? groupName : joinCode} onChangeText={groupAction === 'create' ? setGroupName : (value) => setJoinCode(value.toUpperCase())} placeholder={groupAction === 'create' ? 'اسم المجموعة' : 'رمز الدخول المكوّن من ٦ خانات'} placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={groupAction === 'join' ? 6 : 80} autoCapitalize="characters" />
            <TouchableOpacity style={styles.primaryModalButton} onPress={groupAction === 'create' ? createGroup : joinGroup}><Text style={styles.primaryModalText}>{groupAction === 'create' ? 'إنشاء المجموعة' : 'انضمام'}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setGroupAction(null)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={shareVisible} transparent animationType="fade" onRequestClose={() => setShareVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setShareVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>مشاركة المجموعة</Text>
            <Text style={styles.shareCodeText}>رمز الانضمام: {activeGroup.code}</Text>
            <Text style={styles.modalHint}>شارك هذا الرمز مع من تريد إضافته إلى المجموعة.</Text>
            <TouchableOpacity style={styles.primaryModalButton} onPress={() => setShareVisible(false)}><Text style={styles.primaryModalText}>حسنًا</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={requestsVisible} transparent animationType="fade" onRequestClose={() => setRequestsVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setRequestsVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>طلبات الانضمام المعلقة</Text>
            {activeGroup.pending.map((name) => (
              <View key={name} style={styles.requestRow}>
                <Text style={styles.requestName}>{name}</Text>
                <View style={styles.requestButtons}>
                  <TouchableOpacity style={styles.rejectButton} onPress={() => rejectRequest(name)}><Text style={styles.rejectText}>رفض</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.acceptButton} onPress={() => acceptRequest(name)}><Text style={styles.acceptText}>قبول</Text></TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={() => setRequestsVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={membersVisible} transparent animationType="fade" onRequestClose={() => setMembersVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setMembersVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>أعضاء المجموعة</Text>
            {activeGroup.members.map((name) => <View key={name} style={styles.memberRow}><View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{name.charAt(0)}</Text></View><Text style={styles.memberName}>{name}{name === 'محمود' ? ' (أنت)' : ''}</Text>{name === activeGroup.manager && <Text style={styles.managerBadge}>مدير</Text>}</View>)}
            <TouchableOpacity onPress={() => setMembersVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={exitVisible} transparent animationType="fade" onRequestClose={() => setExitVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setExitVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>تعيين مدير بديل</Text>
            <Text style={styles.modalHint}>اختر مديرًا للمجموعة قبل مغادرتك.</Text>
            {activeGroup.members.filter((name) => name !== 'محمود').map((name) => <TouchableOpacity key={name} style={styles.managerChoice} onPress={() => leaveGroup(name)}><Text style={styles.memberName}>{name}</Text><Text style={styles.chooseText}>تعيين مدير</Text></TouchableOpacity>)}
            <TouchableOpacity onPress={() => setExitVisible(false)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ShoppingRow({ item, onToggle, onQuantity, onDelete, editingId, editedName, onEdit, onEditedName, onSave }: { item: Item; onToggle: (id: string) => void; onQuantity: (id: string, amount: number) => void; onDelete: (id: string) => void; editingId: string | null; editedName: string; onEdit: (item: Item) => void; onEditedName: (name: string) => void; onSave: () => void }) {
  const isEditing = editingId === item.id;
  const canEdit = item.addedBy === 'محمود';
  return (
    <View style={[styles.itemRow, item.purchased && styles.purchasedRow]}>
      {isEditing ? (
        <View style={styles.itemTap}>
          <TextInput value={editedName} onChangeText={onEditedName} onSubmitEditing={onSave} autoFocus textAlign="right" style={styles.inlineEdit} />
          <TouchableOpacity style={styles.editButton} onPress={onSave}><Text style={styles.editButtonText}>حفظ</Text></TouchableOpacity>
        </View>
      ) : (
      <TouchableOpacity style={styles.itemTap} onPress={() => onToggle(item.id)} activeOpacity={0.7}>
        <View style={styles.itemDetails}>
          <Text style={[styles.itemName, item.purchased && styles.purchasedName]}>{item.name}</Text>
          <View style={styles.metaLine}><Text style={styles.meta}>أضافه: {item.addedBy}{item.purchasedBy ? `  •  تم شراؤه: ${item.purchasedBy}` : ''}</Text>{canEdit && <TouchableOpacity onPress={() => onEdit(item)}><Text style={styles.editText}>تعديل</Text></TouchableOpacity>}</View>
        </View>
      </TouchableOpacity>
      )}
      <View style={styles.quantity}>
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, -1)}><Minus size={17} color={colors.primary} /></TouchableOpacity>
        <Text style={styles.quantityValue}>{item.quantity}</Text>
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, 1)}><Plus size={17} color={colors.primary} /></TouchableOpacity>
      </View>
      {item.purchased && <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(item.id)}><X size={18} color={colors.danger} /></TouchableOpacity>}
    </View>
  );
}

const colors = { primary: '#159447', primaryLight: '#edfaf1', text: '#202124', muted: '#65706a', placeholder: '#9aa19d', border: '#e3e7e4', danger: '#ca4848', gray: '#f1f3f2' };
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, content: { padding: 20, paddingTop: 30, paddingBottom: 52 }, welcomeScreen: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 28 }, welcomeContent: { alignItems: 'stretch' }, welcomeTitle: { color: colors.text, fontSize: 34, fontWeight: '800', textAlign: 'center' }, welcomeText: { color: colors.muted, textAlign: 'center', fontSize: 16, lineHeight: 25, marginTop: 12, marginBottom: 38 }, welcomePrimary: { height: 58, backgroundColor: colors.primary, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, welcomePrimaryText: { color: '#fff', fontSize: 18, fontWeight: '800' }, welcomeSecondary: { height: 58, borderWidth: 1, borderColor: '#cde5d6', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, welcomeSecondaryText: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  topBar: { gap: 14, borderBottomWidth: 1, borderBottomColor: '#eff1ef', paddingBottom: 15 }, groupTrigger: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 7 }, groupOverline: { color: colors.muted, fontSize: 12 }, groupName: { color: colors.text, fontWeight: '800', fontSize: 24 }, topActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, roundAction: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, backgroundColor: '#f5f7f6' }, actionText: { color: colors.muted, fontSize: 13, fontWeight: '700' }, requestsAction: { backgroundColor: '#fff1f1' }, requestsText: { color: '#b84a4a', fontWeight: '700', fontSize: 13 }, exitAction: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 7 }, exitText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  code: { marginTop: 11, color: colors.primary, fontSize: 14, fontWeight: '700' }, codeValue: { letterSpacing: 1.3 }, notice: { marginTop: 9, color: colors.primary, fontWeight: '700', fontSize: 12, textAlign: 'right' }, addRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 25, alignItems: 'center' }, input: { flex: 1, borderWidth: 1, borderColor: '#d9dedb', borderRadius: 13, height: 48, paddingHorizontal: 15, color: colors.text, fontSize: 16 }, addButton: { height: 48, paddingHorizontal: 22, borderRadius: 13, backgroundColor: colors.primary, justifyContent: 'center' }, addButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  shareButton: { marginTop: 12, height: 48, borderRadius: 13, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#c8ecd5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, shareText: { color: '#207144', fontWeight: '700', fontSize: 15 }, hint: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 13, marginBottom: 21 }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  itemRow: { minHeight: 67, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 9, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff' }, purchasedRow: { backgroundColor: colors.gray, borderColor: '#e5e8e6' }, itemTap: { flex: 1 }, itemDetails: { gap: 4 }, itemName: { color: colors.text, fontWeight: '800', fontSize: 16 }, purchasedName: { color: '#7c8580', textDecorationLine: 'line-through' }, metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, meta: { color: colors.muted, fontSize: 11 }, editText: { color: colors.primary, fontSize: 11, fontWeight: '800' }, inlineEdit: { borderWidth: 1, borderColor: '#bde3cb', borderRadius: 8, height: 33, paddingHorizontal: 8, color: colors.text, fontSize: 15 }, editButton: { alignSelf: 'flex-start', marginTop: 5, backgroundColor: colors.primaryLight, borderRadius: 7, paddingVertical: 4, paddingHorizontal: 12 }, editButtonText: { color: colors.primary, fontWeight: '800', fontSize: 12 }, quantity: { direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: 6 }, quantityButton: { width: 29, height: 29, borderRadius: 7, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, quantityValue: { color: colors.text, fontWeight: '800', fontSize: 16, minWidth: 17, textAlign: 'center' }, deleteButton: { padding: 4 }, divider: { height: 1, backgroundColor: '#e8ebe9', marginVertical: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end', padding: 16 }, sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 11 }, modalTitle: { color: colors.text, fontWeight: '800', fontSize: 21, textAlign: 'center', marginBottom: 6 }, modalInput: { borderWidth: 1, borderColor: '#d9dedb', borderRadius: 12, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 16 }, modalHint: { color: colors.muted, textAlign: 'center', lineHeight: 21 }, shareCodeText: { color: colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 18, letterSpacing: 1.2 }, groupOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, activeGroup: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, groupOptionName: { color: colors.text, fontSize: 16, fontWeight: '800' }, groupOptionCode: { color: colors.muted, marginTop: 3, fontSize: 12 }, primaryModalButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 }, primaryModalText: { color: '#fff', fontWeight: '800', fontSize: 16 }, secondaryModalButton: { borderColor: '#d6ded9', borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, secondaryModalText: { color: colors.text, fontWeight: '800', fontSize: 16 }, closeText: { color: colors.muted, textAlign: 'center', fontWeight: '700', paddingTop: 6, paddingBottom: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 13 }, requestName: { color: colors.text, fontWeight: '700', fontSize: 16 }, requestButtons: { flexDirection: 'row', gap: 8 }, acceptButton: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, acceptText: { color: '#fff', fontWeight: '800' }, rejectButton: { borderColor: '#e3b9b9', borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, rejectText: { color: colors.danger, fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 12 }, memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff3dd', alignItems: 'center', justifyContent: 'center' }, memberAvatarText: { color: '#b57814', fontSize: 17, fontWeight: '800' }, memberName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }, managerBadge: { color: '#a66b17', backgroundColor: '#fff3dd', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10, fontSize: 12, fontWeight: '800' }, managerChoice: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d7e5db', borderRadius: 10, padding: 12, gap: 8 }, chooseText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
});
