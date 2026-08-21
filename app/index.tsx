import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  Alert,
  ScrollView,
  StatusBar,
  Platform,
  Share,
} from 'react-native';
import { createClient } from '@supabase/supabase-js';

// --- تهيئة الاتصال بـ Supabase ---
const SUPABASE_URL = 'https://qncmbnkxidfotutdydmt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_47UYhExXAppPE6hG9F3UZA_vYArEWAN';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface Item {
  id: string;
  text: string;
  addedBy: string;
  category: string;
  quantity: number;
  completed: boolean;
  householdCode: string;
}

interface Member {
  id: string;
  name: string;
  status: 'approved' | 'pending';
  isAdmin: boolean;
}

const CATEGORIES: { [key: string]: string[] } = {
  '🍞 مخبوزات': ['خبز', 'توست', 'صامولي', 'مفرود', 'كيك', 'كرواسون', 'شابورة'],
  '🥦 خضار وفواكه': ['بصل', 'طماطم', 'خيار', 'بطاطس', 'تفاح', 'موز', 'ليمون', 'كوسة', 'جزر', 'ثوم', 'خس'],
  '🥛 ألبان وأجبان': ['حليب', 'لبن', 'جبن', 'جبنة', 'قشطة', 'زبدة', 'روب', 'زبادي', 'كريمة'],
  '🥩 لحوم وأسماك': ['دجاج', 'لحم', 'سمك', 'روبيان', 'مفروم'],
  '🥫 مواد غذائية ومشروبات': ['رز', 'أرز', 'زيت', 'سكر', 'شاي', 'شاهي', 'قهوة', 'مكرونة', 'صلصة', 'ماء', 'عصير', 'ببسي', 'بيبسي', 'سفن', 'حمضيات', 'غازيات'],
};

const detectCategory = (text: string): string => {
  const lowerText = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some((keyword) => lowerText.includes(keyword))) {
      return category;
    }
  }
  return '📦 أغراض أخرى';
};

export default function App() {
  const [screen, setScreen] = useState<'welcome' | 'create' | 'join' | 'pending' | 'main'>('welcome');
  const [userName, setUserName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const [newItemText, setNewItemText] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  const inputRef = useRef<TextInput>(null);

  const fetchItems = async () => {
    if (!familyCode) return;
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('household_code', familyCode)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const formattedItems: Item[] = data.map((d: any) => ({
        id: d.id,
        text: d.text,
        addedBy: d.added_by || 'عضو',
        category: d.category || '📦 أغراض أخرى',
        quantity: d.quantity || 1,
        completed: d.completed || false,
        householdCode: d.household_code,
      }));
      setItems(formattedItems);
    }
  };

  const fetchMembers = async () => {
    if (!familyCode) return;
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('household_code', familyCode);

    if (!error && data) {
      const formattedMembers: Member[] = data.map((d: any) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        isAdmin: d.is_admin,
      }));
      setMembers(formattedMembers);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchMembers();

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, fetchItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, fetchMembers)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyCode]);

  const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const handleCreateHousehold = async () => {
    if (!userName.trim()) {
      Alert.alert('تنبيه', 'الرجاء إدخال اسمك أولاً');
      return;
    }
    const code = generateCode();

    const { error: hError } = await supabase.from('households').insert([{ code: code }]);
    if (hError) {
      Alert.alert('خطأ', 'تعذر إنشاء المجموعة في قاعدة البيانات');
      return;
    }

    await supabase.from('members').insert([
      {
        household_code: code,
        name: userName.trim(),
        is_admin: true,
        status: 'approved',
      },
    ]);

    setFamilyCode(code);
    setIsAdmin(true);
    setScreen('main');
  };

  const handleJoinHousehold = async () => {
    if (!userName.trim() || !inputCode.trim()) {
      Alert.alert('تنبيه', 'الرجاء إدخال الاسم ورمز العائلة');
      return;
    }
    const cleanCode = inputCode.trim().toUpperCase();

    const { data, error } = await supabase
      .from('households')
      .select('code')
      .eq('code', cleanCode);

    if (error || !data || data.length === 0) {
      Alert.alert('خطأ', 'رمز العائلة غير موجود');
      return;
    }

    await supabase.from('members').insert([
      {
        household_code: cleanCode,
        name: userName.trim(),
        is_admin: false,
        status: 'pending',
      },
    ]);

    setFamilyCode(cleanCode);
    setIsAdmin(false);
    setScreen('pending');
  };

  const handleShareCode = async () => {
    try {
      await Share.share({
        message: `انضم لقائمة المقاضي العائلية الخاصة بنا! استخدم رمز الانضمام: ${familyCode}`,
      });
    } catch (error) {
      console.log(error);
    }
  };

  const handleAddItem = async () => {
    if (!newItemText.trim() || !familyCode) return;
    const authorName = userName.trim() ? userName.trim() : 'عضو';
    const category = detectCategory(newItemText.trim());

    await supabase.from('items').insert([
      {
        household_code: familyCode,
        text: newItemText.trim(),
        added_by: authorName,
        category: category,
        quantity: 1,
        completed: false,
      },
    ]);
    
    setNewItemText('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    fetchItems();
  };

  const toggleItem = async (id: string, completed: boolean) => {
    await supabase.from('items').update({ completed: !completed }).eq('id', id);
    fetchItems();
  };

  const updateQuantity = async (id: string, qty: number, delta: number) => {
    const newQty = qty + delta;
    if (newQty < 1) return;
    await supabase.from('items').update({ quantity: newQty }).eq('id', id);
    fetchItems();
  };

  const deleteItem = async (id: string) => {
    await supabase.from('items').delete().eq('id', id);
    fetchItems();
  };

  const approveMember = async (id: string) => {
    await supabase.from('members').update({ status: 'approved' }).eq('id', id);
    fetchMembers();
  };

  const activeItems = items
    .filter((i) => !i.completed)
    .sort((a, b) => a.category.localeCompare(b.category));

  const completedItems = items.filter((i) => i.completed);
  const pendingMembers = members.filter((m) => m.status === 'pending');
  const approvedMembers = members.filter((m) => m.status === 'approved');

  if (screen === 'welcome') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.title}>قائمة العائلة</Text>
          <Text style={styles.subtitle}>قائمة تسوق مشتركة لعائلتك في مكان واحد</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen('create')}>
            <Text style={styles.primaryButtonText}>إنشاء عائلة جديدة +</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('join')}>
            <Text style={styles.secondaryButtonText}>انضمام بواسطة رمز الدخول</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'create') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.title}>إنشاء عائلة جديدة</Text>
          <Text style={styles.subtitle}>أدخل اسمك لتصبح مدير المجموعة</Text>
          <TextInput
            style={styles.input}
            placeholder="مثال: أبو المثنى"
            value={userName}
            onChangeText={setUserName}
            textAlign="right"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleCreateHousehold}>
            <Text style={styles.primaryButtonText}>إنشاء الحساب</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen('welcome')} style={styles.linkButton}>
            <Text style={styles.linkText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'join') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.title}>انضمام لعائلة</Text>
          <Text style={styles.subtitle}>أدخل اسمك ورمز العائلة المكون من 6 أرقام/أحرف</Text>
          <TextInput
            style={styles.input}
            placeholder="اسمك (مثال: أم أحمد)"
            value={userName}
            onChangeText={setUserName}
            textAlign="right"
          />
          <TextInput
            style={[styles.input, { letterSpacing: 3, textTransform: 'uppercase' }]}
            placeholder="رمز العائلة (مثال: ABC123)"
            value={inputCode}
            onChangeText={setInputCode}
            autoCapitalize="characters"
            textAlign="center"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleJoinHousehold}>
            <Text style={styles.primaryButtonText}>إرسال طلب الانضمام</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen('welcome')} style={styles.linkButton}>
            <Text style={styles.linkText}>رجوع</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'pending') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.title}>بانتظار موافقة المشرف</Text>
          <Text style={styles.subtitle}>
            تم إرسال طلب انضمامك للرمز ({familyCode}). سيتم دخولك للقائمة فور قبول المدير لطلبك.
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('main')}>
            <Text style={styles.secondaryButtonText}>معاينة القائمة (تجريبي)</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen('welcome')} style={styles.linkButton}>
            <Text style={styles.linkText}>رجوع للرئيسية</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* الهيدر */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setShowAboutModal(true)} style={styles.infoBtn}>
            <Text style={styles.infoBtnText}>❗</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMembersModal(true)} style={styles.badge}>
            <Text style={styles.badgeText}>الأعضاء ({approvedMembers.length})</Text>
          </TouchableOpacity>
          {isAdmin && pendingMembers.length > 0 && (
            <TouchableOpacity onPress={() => setShowRequestsModal(true)} style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>الطلبات ({pendingMembers.length})</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.headerTitle}>قائمة المقاضي</Text>
          <Text style={styles.headerCode}>رمز الانضمام: {familyCode}</Text>
        </View>
      </View>

      {/* زر مشاركة رابط العائلة */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TouchableOpacity style={styles.shareBannerBtn} onPress={handleShareCode}>
          <Text style={styles.shareBannerText}>🔗 مشاركة رابط/رمز انضمام العائلة</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.addButton} onPress={handleAddItem}>
          <Text style={styles.addButtonText}>إضافة</Text>
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={styles.mainInput}
          placeholder="اكتب غرض جديد..."
          value={newItemText}
          onChangeText={setNewItemText}
          onSubmitEditing={handleAddItem}
          blurOnSubmit={false}
          textAlign="right"
        />
      </View>

      <Text style={styles.hintText}>💡 اضغط على الغرض لنقله إلى قسم "تم شراؤها"</Text>

      <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
        {activeItems.map((item) => (
          <View key={item.id} style={styles.itemCard}>
            {/* 1. اسم الغرض أقصى اليمين */}
            <TouchableOpacity
              style={{ flex: 2, alignItems: 'flex-start' }}
              onPress={() => toggleItem(item.id, item.completed)}
            >
              <Text style={styles.itemText}>{item.text}</Text>
            </TouchableOpacity>

            {/* 2. العداد في المنتصف */}
            <View style={styles.qtyContainer}>
              <TouchableOpacity onPress={() => updateQuantity(item.id, item.quantity, 1)} style={styles.qtyBtn}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={styles.qtyText}>{item.quantity}</Text>
              <TouchableOpacity onPress={() => updateQuantity(item.id, item.quantity, -1)} style={styles.qtyBtn}>
                <Text style={styles.qtyBtnText}>-</Text>
              </TouchableOpacity>
            </View>

            {/* 3. اسم المضيف الأصلي أقصى اليسار */}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={styles.itemUser}>{item.addedBy}</Text>
            </View>
          </View>
        ))}

        {completedItems.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>تم شراؤها (انقر على الغرض لاستعادته)</Text>
            {completedItems.map((item) => (
              <View key={item.id} style={[styles.itemCard, styles.completedCard]}>
                {/* 1. اسم الغرض أقصى اليمين */}
                <TouchableOpacity
                  style={{ flex: 2, alignItems: 'flex-start' }}
                  onPress={() => toggleItem(item.id, item.completed)}
                >
                  <Text style={[styles.itemText, styles.completedText]}>{item.text}</Text>
                </TouchableOpacity>

                {/* 2. اسم الشخص الذي أضاف الغرض أصلاً في المنتصف */}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={styles.itemUser}>بواسطة: {item.addedBy}</Text>
                </View>

                {/* 3. زر الحذف X أقصى اليسار */}
                <TouchableOpacity onPress={() => deleteItem(item.id)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* نافذة "عن التطبيق والتواصل" */}
      <Modal visible={showAboutModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>عن التطبيق 💡</Text>
            <Text style={styles.aboutText}>
              تطبيق "قائمة العائلة" هو مساحتك المشتركة لتنظيم وتسوق المقاضي والاحتياجات اليومية مع أفراد عائلتك في وقت حي ومباشر دون تكرار للشراء.
            </Text>
            <Text style={styles.aboutSubTitle}>📧 للتواصل والإقتراحات:</Text>
            <Text style={styles.emailText}>support@familylist.app</Text>
            <TouchableOpacity onPress={() => setShowAboutModal(false)} style={[styles.primaryButton, { marginTop: 20 }]}>
              <Text style={styles.primaryButtonText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* نافذة الأعضاء */}
      <Modal visible={showMembersModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>أعضاء العائلة</Text>
            {approvedMembers.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <Text style={styles.roleTag}>{m.isAdmin ? 'مدير' : 'عضو'}</Text>
                <Text style={styles.memberName}>{m.name}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => setShowMembersModal(false)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* نافذة الطلبات */}
      <Modal visible={showRequestsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>طلبات الانضمام المعلقة</Text>
            {pendingMembers.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <TouchableOpacity onPress={() => approveMember(m.id)} style={styles.approveBtn}>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>قبول</Text>
                </TouchableOpacity>
                <Text style={styles.memberName}>{m.name}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => setShowRequestsModal(false)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0,
  },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 32 },
  input: { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16 },
  primaryButton: { width: '100%', backgroundColor: '#16a34a', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  secondaryButton: { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  secondaryButtonText: { color: '#334155', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 16 },
  linkText: { color: '#64748b', fontSize: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
  headerCode: { fontSize: 12, color: '#16a34a', fontWeight: 'bold', marginTop: 2 },
  badge: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, color: '#475569', fontWeight: 'bold' },
  alertBadge: { backgroundColor: '#fef2f2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  alertBadgeText: { fontSize: 12, color: '#dc2626', fontWeight: 'bold' },
  infoBtn: { backgroundColor: '#eff6ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  infoBtnText: { fontSize: 14 },
  shareBannerBtn: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareBannerText: { color: '#16a34a', fontWeight: 'bold', fontSize: 14 },
  inputContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  mainInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14 },
  addButton: { backgroundColor: '#16a34a', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  hintText: { fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 12 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#64748b', marginTop: 20, marginBottom: 10, textAlign: 'right' },

  itemCard: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  itemText: { fontSize: 16, color: '#1e293b', fontWeight: 'bold' },
  itemUser: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  completedCard: { backgroundColor: '#f8fafc', opacity: 0.7 },
  completedText: { textDecorationLine: 'line-through', color: '#94a3b8' },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, padding: 2 },
  qtyBtn: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: 6 },
  qtyBtnText: { fontSize: 16, fontWeight: 'bold' },
  qtyText: { paddingHorizontal: 10, fontSize: 14, fontWeight: 'bold' },
  deleteBtn: { padding: 6, backgroundColor: '#fef2f2', borderRadius: 6 },
  deleteBtnText: { color: '#dc2626', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  aboutText: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  aboutSubTitle: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', textAlign: 'center', marginTop: 8 },
  emailText: { fontSize: 14, color: '#16a34a', fontWeight: 'bold', textAlign: 'center', marginTop: 4 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  memberName: { fontSize: 16, color: '#334155' },
  roleTag: { color: '#16a34a', fontWeight: 'bold' },
  approveBtn: { backgroundColor: '#16a34a', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
});
