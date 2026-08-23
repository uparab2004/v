import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  I18nManager,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, Clipboard, LogOut, Minus, Pencil, Plus, Users, X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

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
  const [memberName, setMemberName] = useState('');
  const [pendingJoin, setPendingJoin] = useState<{ id: string; name: string; code: string; ownerName: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<TextInput>(null);
  const currentUser = memberName.trim();

  const addItem = () => {
    const name = newItem.trim();
    if (!name || !currentUser) return;
    setItems((current) => [
      { id: String(Date.now()), name, quantity: 1, addedBy: currentUser, purchased: false },
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
        ? { ...item, purchased: !item.purchased, purchasedBy: !item.purchased ? currentUser : undefined }
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
  const refreshMembers = async (groupId: string) => {
    const { data, error } = await supabase.from('maqadhi_v2_members').select('name, role, status').eq('group_id', groupId);
    if (error || !data) return;
    const members = data.filter((entry) => entry.status === 'approved').map((entry) => entry.name);
    const pending = data.filter((entry) => entry.status === 'pending').map((entry) => entry.name);
    const manager = data.find((entry) => entry.role === 'manager')?.name ?? '';
    if (currentUser && !members.includes(currentUser)) {
      setGroupList((current) => current.filter((group) => group.id !== groupId));
      setActiveGroup((current) => current?.id === groupId ? null : current);
      setItems([]);
      setNotice('تمت إزالتك من المجموعة.');
      return;
    }
    setActiveGroup((current) => current?.id === groupId ? { ...current, members, pending, manager } : current);
    setGroupList((current) => current.map((group) => group.id === groupId ? { ...group, members, pending, manager } : group));
  };

  useEffect(() => {
    if (!activeGroup) return;
    void refreshMembers(activeGroup.id);
    const timer = setInterval(() => void refreshMembers(activeGroup.id), 4000);
    return () => clearInterval(timer);
  }, [activeGroup?.id]);

  useEffect(() => {
    if (!pendingJoin || !currentUser) return;
    const checkApproval = async () => {
      const { data } = await supabase.from('maqadhi_v2_members').select('status').eq('group_id', pendingJoin.id).eq('name', currentUser).maybeSingle();
      if (data?.status !== 'approved') return;
      const group: Group = { id: pendingJoin.id, name: pendingJoin.name, code: pendingJoin.code, members: [], pending: [], manager: pendingJoin.ownerName };
      setGroupList((current) => current.some((entry) => entry.id === group.id) ? current : [group, ...current]);
      setActiveGroup(group);
      setPendingJoin(null);
      await refreshMembers(group.id);
    };
    void checkApproval();
    const timer = setInterval(() => void checkApproval(), 4000);
    return () => clearInterval(timer);
  }, [pendingJoin?.id, currentUser]);

  const createGroup = async () => {
    const name = groupName.trim();
    const owner = memberName.trim();
    if (!name || !owner) {
      setActionError('أدخل اسمك واسم المجموعة.');
      return;
    }
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data, error } = await supabase.from('maqadhi_v2_groups').insert({ name, code, owner_name: owner }).select('id, name, code, owner_name').single();
    if (error || !data) {
      setActionError('تعذر إنشاء المجموعة. حاول مرة أخرى.');
      return;
    }
    const { error: memberError } = await supabase.from('maqadhi_v2_members').insert({ group_id: data.id, name: owner, role: 'manager', status: 'approved' });
    if (memberError) {
      setActionError('تم إنشاء المجموعة، لكن تعذر إضافة المدير.');
      return;
    }
    const group: Group = { id: data.id, name: data.name, code: data.code, members: [owner], pending: [], manager: owner };
    setGroupList((current) => [group, ...current]);
    setActiveGroup(group);
    setItems([]);
    setGroupName('');
    setGroupAction(null);
    setGroupsVisible(false);
    setActionError('');
    setNotice('');
  };
  const joinGroup = async () => {
    const code = joinCode.trim().toUpperCase();
    const name = memberName.trim();
    if (!name || code.length !== 6) {
      setActionError('أدخل اسمك ورمز المجموعة المكوّن من ٦ خانات.');
      return;
    }
    const { data: remoteGroup, error: groupError } = await supabase.from('maqadhi_v2_groups').select('id, name, code, owner_name').eq('code', code).maybeSingle();
    if (groupError || !remoteGroup) {
      setActionError('رمز المجموعة غير صحيح.');
      return;
    }
    const { data: existing, error: existingError } = await supabase.from('maqadhi_v2_members').select('status, role').eq('group_id', remoteGroup.id).eq('name', name).maybeSingle();
    if (existingError) {
      setActionError('حدث خطأ. حاول مرة أخرى.');
      return;
    }
    if (existing?.status === 'approved') {
      const group: Group = { id: remoteGroup.id, name: remoteGroup.name, code: remoteGroup.code, members: [], pending: [], manager: remoteGroup.owner_name };
      setGroupList((current) => current.some((entry) => entry.id === group.id) ? current : [group, ...current]);
      setActiveGroup(group);
      setJoinCode('');
      setGroupAction(null);
      setGroupsVisible(false);
      setActionError('');
      setNotice('');
      await refreshMembers(group.id);
    } else if (existing?.status === 'pending') {
      setPendingJoin({ id: remoteGroup.id, name: remoteGroup.name, code: remoteGroup.code, ownerName: remoteGroup.owner_name });
      setJoinCode('');
      setGroupAction(null);
      setGroupsVisible(false);
      setActionError('');
    } else {
      const { error: requestError } = await supabase.from('maqadhi_v2_members').insert({ group_id: remoteGroup.id, name, role: 'member', status: 'pending' });
      if (requestError) {
        setActionError('تعذر إرسال طلب الانضمام. حاول مرة أخرى.');
        return;
      }
      setPendingJoin({ id: remoteGroup.id, name: remoteGroup.name, code: remoteGroup.code, ownerName: remoteGroup.owner_name });
      setJoinCode('');
      setGroupAction(null);
      setGroupsVisible(false);
      setActionError('');
    }
  };
  const leaveGroup = async (nextManager: string) => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const { error: managerError } = await supabase.from('maqadhi_v2_members').update({ role: 'manager' }).eq('group_id', groupId).eq('name', nextManager);
    if (managerError) {
      setNotice('تعذر تعيين المدير البديل. حاول مرة أخرى.');
      return;
    }
    const { error: groupError } = await supabase.from('maqadhi_v2_groups').update({ owner_name: nextManager }).eq('id', groupId);
    if (groupError) {
      await supabase.from('maqadhi_v2_members').update({ role: 'member' }).eq('group_id', groupId).eq('name', nextManager);
      setNotice('تعذر إتمام المغادرة. حاول مرة أخرى.');
      return;
    }
    const { error: leaveError } = await supabase.from('maqadhi_v2_members').delete().eq('group_id', groupId).eq('name', currentUser);
    if (leaveError) {
      setNotice('تعذر إتمام المغادرة. حاول مرة أخرى.');
      return;
    }
    setExitVisible(false);
    const updated = { ...activeGroup, manager: nextManager, members: activeGroup.members.filter((name) => name !== currentUser) };
    const remaining = groupList.filter((group) => group.id !== updated.id);
    setGroupList(remaining);
    const alternative = remaining[0];
    if (alternative) {
      setActiveGroup(alternative);
      setNotice('');
    } else {
      setActiveGroup(null);
      setNotice('');
    }
  };

  const deleteCurrentGroup = async () => {
    if (!activeGroup) return;
    const { error } = await supabase.from('maqadhi_v2_groups').delete().eq('id', activeGroup.id);
    if (error) {
      setNotice('تعذر حذف المجموعة. حاول مرة أخرى.');
      return;
    }
    const remaining = groupList.filter((group) => group.id !== activeGroup.id);
    setGroupList(remaining);
    setActiveGroup(remaining[0] ?? null);
    setItems([]);
    setExitVisible(false);
    setNotice('');
  };

  const acceptRequest = async (name: string) => {
    if (!activeGroup) return;
    const { error } = await supabase.from('maqadhi_v2_members').update({ status: 'approved' }).eq('group_id', activeGroup.id).eq('name', name);
    if (error) {
      setNotice('تعذر قبول طلب الانضمام.');
      return;
    }
    await refreshMembers(activeGroup.id);
  };

  const rejectRequest = async (name: string) => {
    if (!activeGroup) return;
    const { error } = await supabase.from('maqadhi_v2_members').delete().eq('group_id', activeGroup.id).eq('name', name);
    if (error) {
      setNotice('تعذر رفض طلب الانضمام.');
      return;
    }
    await refreshMembers(activeGroup.id);
  };

  const removeMember = (name: string) => {
    if (!activeGroup || activeGroup.manager !== currentUser || name === activeGroup.manager) return;
    Alert.alert('إزالة عضو', `هل تريد إزالة ${name} من المجموعة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إزالة',
        style: 'destructive',
        onPress: () => void confirmRemoveMember(name),
      },
    ]);
  };

  const confirmRemoveMember = async (name: string) => {
    if (!activeGroup || activeGroup.manager !== currentUser) return;
    const { error } = await supabase.from('maqadhi_v2_members').delete().eq('group_id', activeGroup.id).eq('name', name);
    if (error) {
      setNotice('تعذر إزالة العضو. حاول مرة أخرى.');
      return;
    }
    setNotice(`تمت إزالة ${name} من المجموعة.`);
    await refreshMembers(activeGroup.id);
  };

  const share = () => setShareVisible(true);
  const shareCode = async () => {
    await Share.share({ title: 'رمز الانضمام إلى مجموعة مقاضي', message: `رمز الانضمام إلى مجموعة «${activeGroup?.name}»: ${activeGroup?.code}` });
  };
  const requestedCount = activeGroup?.pending.length ?? 0;
  const wanted = items.filter((item) => !item.purchased);
  const bought = items.filter((item) => item.purchased);

  if (pendingJoin) {
    return (
      <View style={styles.welcomeScreen}>
        <View style={styles.waitingCard}>
          <Text style={styles.waitingIcon}>◷</Text>
          <Text style={styles.welcomeTitle}>بانتظار الموافقة</Text>
          <Text style={styles.welcomeText}>تم إرسال طلب انضمامك إلى مجموعة «{pendingJoin.name}» برمز {pendingJoin.code}.</Text>
          <Text style={styles.waitingText}>سيتم فتح المجموعة تلقائيًا بعد اعتماد المدير لطلبك.</Text>
          <TouchableOpacity style={styles.welcomeSecondary} onPress={() => setPendingJoin(null)}><Text style={styles.welcomeSecondaryText}>العودة إلى الصفحة الرئيسية</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

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
              <TextInput value={memberName} onChangeText={setMemberName} placeholder="اسمك" placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={40} />
              <TextInput value={groupAction === 'create' ? groupName : joinCode} onChangeText={groupAction === 'create' ? setGroupName : (value) => setJoinCode(value.toUpperCase())} placeholder={groupAction === 'create' ? 'اسم المجموعة' : 'رمز الدخول المكوّن من ٦ خانات'} placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={groupAction === 'join' ? 6 : 80} autoCapitalize="characters" />
              {!!actionError && <Text style={styles.actionError}>{actionError}</Text>}
              <TouchableOpacity style={styles.primaryModalButton} onPress={groupAction === 'create' ? createGroup : joinGroup}><Text style={styles.primaryModalText}>{groupAction === 'create' ? 'إنشاء المجموعة' : 'انضمام'}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setGroupAction(null)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  const otherMembers = activeGroup.members.filter((name) => name !== currentUser);
  const isCurrentUserManager = activeGroup.manager === currentUser;

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
          <ShoppingRow key={item.id} item={item} currentUser={currentUser} onToggle={togglePurchased} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />
        ))}

        {bought.length > 0 && <View style={styles.divider} />}
        {bought.length > 0 && <Text style={styles.sectionTitle}>تم شراؤه ({bought.length})</Text>}
        {bought.map((item) => (
          <ShoppingRow key={item.id} item={item} currentUser={currentUser} onToggle={togglePurchased} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />
        ))}
      </ScrollView>

      <Modal visible={groupsVisible} transparent animationType="fade" onRequestClose={() => setGroupsVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setGroupsVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>مجموعاتي</Text>
            {groupList.map((group) => (
              <TouchableOpacity key={group.id} style={[styles.groupOption, group.id === activeGroup.id && styles.activeGroup]} onPress={() => { setActiveGroup(group); setNotice(''); setGroupsVisible(false); }}>
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
            <TextInput value={memberName} onChangeText={setMemberName} placeholder="اسمك" placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={40} />
            <TextInput value={groupAction === 'create' ? groupName : joinCode} onChangeText={groupAction === 'create' ? setGroupName : (value) => setJoinCode(value.toUpperCase())} placeholder={groupAction === 'create' ? 'اسم المجموعة' : 'رمز الدخول المكوّن من ٦ خانات'} placeholderTextColor={colors.placeholder} style={styles.modalInput} textAlign="right" maxLength={groupAction === 'join' ? 6 : 80} autoCapitalize="characters" />
            {!!actionError && <Text style={styles.actionError}>{actionError}</Text>}
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
            <Text style={styles.modalHint}>أرسل هذا الرمز لمن تريد إضافته إلى المجموعة.</Text>
            <TouchableOpacity style={styles.primaryModalButton} onPress={shareCode}><Text style={styles.primaryModalText}>مشاركة الرمز</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShareVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
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
            {activeGroup.members.map((name) => <View key={name} style={styles.memberRow}><View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{name.charAt(0)}</Text></View><Text style={styles.memberName}>{name}{name === currentUser ? ' (أنت)' : ''}</Text>{name === activeGroup.manager && <Text style={styles.managerBadge}>مدير</Text>}{isCurrentUserManager && name !== activeGroup.manager && <TouchableOpacity style={styles.removeMemberButton} onPress={() => removeMember(name)}><Text style={styles.removeMemberText}>إزالة</Text></TouchableOpacity>}</View>)}
            <TouchableOpacity onPress={() => setMembersVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={exitVisible} transparent animationType="fade" onRequestClose={() => setExitVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setExitVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>{otherMembers.length ? 'تعيين مدير بديل' : 'مغادرة المجموعة'}</Text>
            {otherMembers.length ? <Text style={styles.modalHint}>اختر مديرًا للمجموعة قبل مغادرتك.</Text> : <Text style={styles.modalHint}>أنت العضو الوحيد. ستُحذف المجموعة عند مغادرتك.</Text>}
            {otherMembers.map((name) => <TouchableOpacity key={name} style={styles.managerChoice} onPress={() => leaveGroup(name)}><Text style={styles.memberName}>{name}</Text><Text style={styles.chooseText}>تعيين مدير</Text></TouchableOpacity>)}
            {!otherMembers.length && <TouchableOpacity style={styles.deleteGroupButton} onPress={deleteCurrentGroup}><Text style={styles.deleteGroupText}>حذف المجموعة والمغادرة</Text></TouchableOpacity>}
            <TouchableOpacity onPress={() => setExitVisible(false)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ShoppingRow({ item, currentUser, onToggle, onQuantity, onDelete, editingId, editedName, onEdit, onEditedName, onSave }: { item: Item; currentUser: string; onToggle: (id: string) => void; onQuantity: (id: string, amount: number) => void; onDelete: (id: string) => void; editingId: string | null; editedName: string; onEdit: (item: Item) => void; onEditedName: (name: string) => void; onSave: () => void }) {
  const isEditing = editingId === item.id;
  const canEdit = item.addedBy === currentUser;
  return (
    <View style={[styles.itemRow, item.purchased && styles.purchasedRow]}>
      {isEditing ? (
        <View style={styles.itemTap}>
          <TextInput value={editedName} onChangeText={onEditedName} onSubmitEditing={onSave} autoFocus selectTextOnFocus textAlign="right" style={styles.inlineEdit} />
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
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, 1)}><Plus size={17} color={colors.primary} /></TouchableOpacity>
        <Text style={styles.quantityValue}>{item.quantity}</Text>
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, -1)}><Minus size={17} color={colors.primary} /></TouchableOpacity>
      </View>
      {item.purchased && <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(item.id)}><X size={18} color={colors.danger} /></TouchableOpacity>}
    </View>
  );
}

const colors = { primary: '#159447', primaryLight: '#edfaf1', text: '#202124', muted: '#65706a', placeholder: '#9aa19d', border: '#e3e7e4', danger: '#ca4848', gray: '#f1f3f2' };
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, content: { padding: 20, paddingTop: 30, paddingBottom: 52 }, welcomeScreen: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 28 }, welcomeContent: { alignItems: 'stretch' }, waitingCard: { alignItems: 'stretch', borderWidth: 1, borderColor: '#dce9e0', borderRadius: 22, padding: 24, backgroundColor: '#fff' }, waitingIcon: { color: colors.primary, fontSize: 54, textAlign: 'center', marginBottom: 6 }, welcomeTitle: { color: colors.text, fontSize: 34, fontWeight: '800', textAlign: 'center' }, welcomeText: { color: colors.muted, textAlign: 'center', fontSize: 16, lineHeight: 25, marginTop: 12, marginBottom: 24 }, waitingText: { color: colors.primary, textAlign: 'center', fontSize: 14, lineHeight: 22, fontWeight: '700' }, welcomePrimary: { height: 58, backgroundColor: colors.primary, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, welcomePrimaryText: { color: '#fff', fontSize: 18, fontWeight: '800' }, welcomeSecondary: { height: 58, borderWidth: 1, borderColor: '#cde5d6', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 20 }, welcomeSecondaryText: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  topBar: { gap: 14, borderBottomWidth: 1, borderBottomColor: '#eff1ef', paddingBottom: 15 }, groupTrigger: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 7 }, groupOverline: { color: colors.muted, fontSize: 12 }, groupName: { color: colors.text, fontWeight: '800', fontSize: 24 }, topActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, roundAction: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, backgroundColor: '#f5f7f6' }, actionText: { color: colors.muted, fontSize: 13, fontWeight: '700' }, requestsAction: { backgroundColor: '#fff1f1' }, requestsText: { color: '#b84a4a', fontWeight: '700', fontSize: 13 }, exitAction: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 7 }, exitText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  code: { marginTop: 11, color: colors.primary, fontSize: 14, fontWeight: '700' }, codeValue: { letterSpacing: 1.3 }, notice: { marginTop: 9, color: colors.primary, fontWeight: '700', fontSize: 12, textAlign: 'right' }, addRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 25, alignItems: 'center' }, input: { flex: 1, borderWidth: 1, borderColor: '#d9dedb', borderRadius: 13, height: 48, paddingHorizontal: 15, color: colors.text, fontSize: 16 }, addButton: { height: 48, paddingHorizontal: 22, borderRadius: 13, backgroundColor: colors.primary, justifyContent: 'center' }, addButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  shareButton: { marginTop: 12, height: 48, borderRadius: 13, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#c8ecd5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, shareText: { color: '#207144', fontWeight: '700', fontSize: 15 }, hint: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 13, marginBottom: 21 }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  itemRow: { minHeight: 67, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 9, paddingVertical: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff' }, purchasedRow: { backgroundColor: colors.gray, borderColor: '#e5e8e6' }, itemTap: { flex: 1, minWidth: 0 }, itemDetails: { gap: 4 }, itemName: { color: colors.text, fontWeight: '800', fontSize: 16 }, purchasedName: { color: '#7c8580', textDecorationLine: 'line-through' }, metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 }, meta: { color: colors.muted, fontSize: 11 }, editText: { color: colors.primary, fontSize: 11, fontWeight: '800' }, inlineEdit: { width: '100%', borderWidth: 1, borderColor: '#bde3cb', borderRadius: 8, height: 42, paddingHorizontal: 11, paddingVertical: 0, color: colors.text, fontSize: 16, textAlign: 'right', writingDirection: 'rtl', includeFontPadding: false }, editButton: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.primaryLight, borderRadius: 7, paddingVertical: 6, paddingHorizontal: 14 }, editButtonText: { color: colors.primary, fontWeight: '800', fontSize: 12 }, quantity: { direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: 6 }, quantityButton: { width: 29, height: 29, borderRadius: 7, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, quantityValue: { color: colors.text, fontWeight: '800', fontSize: 16, minWidth: 17, textAlign: 'center' }, deleteButton: { padding: 4 }, divider: { height: 1, backgroundColor: '#e8ebe9', marginVertical: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end', padding: 16 }, sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 11 }, modalTitle: { color: colors.text, fontWeight: '800', fontSize: 21, textAlign: 'center', marginBottom: 6 }, modalInput: { borderWidth: 1, borderColor: '#d9dedb', borderRadius: 12, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 16 }, actionError: { color: colors.danger, textAlign: 'center', fontSize: 13 }, modalHint: { color: colors.muted, textAlign: 'center', lineHeight: 21 }, shareCodeText: { color: colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 18, letterSpacing: 1.2 }, groupOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, activeGroup: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, groupOptionName: { color: colors.text, fontSize: 16, fontWeight: '800' }, groupOptionCode: { color: colors.muted, marginTop: 3, fontSize: 12 }, primaryModalButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 }, primaryModalText: { color: '#fff', fontWeight: '800', fontSize: 16 }, secondaryModalButton: { borderColor: '#d6ded9', borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, secondaryModalText: { color: colors.text, fontWeight: '800', fontSize: 16 }, closeText: { color: colors.muted, textAlign: 'center', fontWeight: '700', paddingTop: 6, paddingBottom: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 13 }, requestName: { color: colors.text, fontWeight: '700', fontSize: 16 }, requestButtons: { flexDirection: 'row', gap: 8 }, acceptButton: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, acceptText: { color: '#fff', fontWeight: '800' }, rejectButton: { borderColor: '#e3b9b9', borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, rejectText: { color: colors.danger, fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 12 }, memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff3dd', alignItems: 'center', justifyContent: 'center' }, memberAvatarText: { color: '#b57814', fontSize: 17, fontWeight: '800' }, memberName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }, managerBadge: { color: '#a66b17', backgroundColor: '#fff3dd', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10, fontSize: 12, fontWeight: '800' }, removeMemberButton: { borderWidth: 1, borderColor: '#efc4c4', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9 }, removeMemberText: { color: colors.danger, fontSize: 12, fontWeight: '800' }, managerChoice: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d7e5db', borderRadius: 10, padding: 12, gap: 8 }, chooseText: { color: colors.primary, fontWeight: '800', fontSize: 13 }, deleteGroupButton: { backgroundColor: '#fff0f0', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 }, deleteGroupText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
});
