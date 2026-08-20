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
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- تهيئة الاتصال بـ Supabase ---
const SUPABASE_URL = 'https://qncmbnkxidfotutdydmt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_47UYhExXAppPE6hG9F3UZA_vYArEWAN';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const showAlert = (title: string, message?: string) => {
  const fullMsg = message ? `${title}\n${message}` : title;
  if (Platform.OS === 'web' || typeof window !== 'undefined') {
    window.alert(fullMsg);
  } else {
    Alert.alert(title, message);
  }
};

interface Item {
  id: string;
  text: string;
  addedBy: string;
  category: string;
  completed: boolean;
  householdCode: string;
  quantity: number;
}

interface Member {
  id: string;
  name: string;
  status: 'approved' | 'pending';
  isAdmin: boolean;
  householdCode: string;
}

interface HouseholdSession {
  household_code: string;
  household_name: string;
  is_admin: boolean;
}

const CATEGORIES: { [key: string]: string[] } = {
  '🍞 مخبوزات': ['خبز', 'توست', 'صامولي', 'مفرود', 'كيك', 'كرواسون', 'شابورة'],
  '🥦 خضار وفواكه': ['بصل', 'طماطم', 'خيار', 'بطاطس', 'تفاح', 'موز', 'ليمون', 'كوسة', 'جزر', 'ثوم', 'خس', 'جرجير', 'بقدونس'],
  '🥛 ألبان وأجبان': ['حليب', 'لبن', 'جبن', 'جبنة', 'قشطة', 'زبدة', 'روب', 'زبادي', 'كريمة'],
  '🥩 لحوم وأسماك': ['دجاج', 'لحم', 'سمك', 'روبيان', 'مفروم'],
  '🥫 مواد غذائية ومشروبات': ['رز', 'أرز', 'زيت', 'سكر', 'شاي', 'شاهي', 'قهوة', 'مكرونة', 'صلصة', 'ماء', 'عصير', 'ببسي', 'بيبسي', 'سفن', 'حمضيات', 'غازيات', 'صابون', 'تايد'],
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
  const [householdNameInput, setHouseholdNameInput] = useState('');
  const [currentHouseholdName, setCurrentHouseholdName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [myHouseholds, setMyHouseholds] = useState<HouseholdSession[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);

  // حالات نافذة المشاركة الجديدة
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const codeFromUrl = urlParams.get('code');
      if (codeFromUrl) {
        setInputCode(codeFromUrl.toUpperCase().trim());
      }
    }
  }, []);

  useEffect(() => {
    const checkSavedSession = async () => {
      try {
        const savedCode = await AsyncStorage.getItem('familyCode');
        const savedName = await AsyncStorage.getItem('userName');
        const savedHName = await AsyncStorage.getItem('householdName');

        if (savedName) setUserName(savedName);
        if (savedHName) setCurrentHouseholdName(savedHName);

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search);
          const codeFromUrl = urlParams.get('code');
          if (codeFromUrl && codeFromUrl.toUpperCase() !== savedCode) {
            setScreen('join');
            return;
          }
        }

        if (savedCode && savedName) {
          const cleanName = savedName.trim();
          setFamilyCode(savedCode);
          await fetchMyHouseholds(cleanName);

          const { data: memberList } = await supabase
            .from('members')
            .select('status, is_admin')
            .eq('household_code', savedCode)
            .ilike('name', cleanName)
            .order('is_admin', { ascending: false });

          const adminMember = memberList?.find((m) => m.is_admin);
          const approvedMember = memberList?.find((m) => m.status === 'approved');

          if (adminMember || approvedMember) {
            setIsAdmin(!!adminMember || !!approvedMember?.is_admin);
            setScreen('main');
          } else if (memberList && memberList.length > 0 && memberList[0].status === 'pending') {
            setIsAdmin(false);
            setScreen('pending');
          } else {
            setScreen('welcome');
          }
        } else if (inputCode) {
          setScreen('join');
        }
      } catch (e) {
        console.log('Error reading storage', e);
      }
    };
    checkSavedSession();
  }, []);

  const getShareUrl = () => {
    let baseUrl = 'https://shopping-list.app';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      baseUrl = window.location.origin + window.location.pathname;
    }
    return `${baseUrl}?code=${familyCode}`;
  };

  const handleOpenShare = () => {
    setCopied(false);
    setShowShareModal(true);
  };

  const handleCopyLink = async () => {
    const url = getShareUrl();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } else {
        setCopied(true);
      }
    } catch (e) {
      setCopied(true);
    }
  };

  const fetchMyHouseholds = async (name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;

    let candidateCodes: { household_code: string; is_admin: boolean }[] = [];

    const { data: memberData } = await supabase
      .from('members')
      .select('household_code, is_admin')
      .eq('status', 'approved')
      .ilike('name', cleanName);

    if (memberData) {
      candidateCodes = memberData.map((d) => ({ household_code: d.household_code, is_admin: d.is_admin }));
    }

    const uniqueMap = new Map<string, boolean>();
    candidateCodes.forEach((item) => uniqueMap.set(item.household_code, item.is_admin));
    const allCodes = Array.from(uniqueMap.keys());

    if (allCodes.length === 0) {
      setMyHouseholds([]);
      await AsyncStorage.setItem('myHouseholdsList', JSON.stringify([]));
      return;
    }

    const { data: validHouseholds } = await supabase
      .from('households')
      .select('code, name')
      .in('code', allCodes);

    const verifiedHouseholds: HouseholdSession[] = (validHouseholds || []).map((h) => ({
      household_code: h.code,
      household_name: h.name || `عائلة (${h.code})`,
      is_admin: uniqueMap.get(h.code) || false,
    }));

    setMyHouseholds(verifiedHouseholds);

    const activeCurrent = verifiedHouseholds.find((h) => h.household_code === familyCode);
    if (activeCurrent) {
      setCurrentHouseholdName(activeCurrent.household_name);
      await AsyncStorage.setItem('householdName', activeCurrent.household_name);
    }

    await AsyncStorage.setItem('myHouseholdsList', JSON.stringify(verifiedHouseholds));
  };

  const saveSession = async (code: string, name: string, hName: string, adminStatus: boolean) => {
    try {
      await AsyncStorage.setItem('familyCode', code);
      await AsyncStorage.setItem('userName', name);
      await AsyncStorage.setItem('householdName', hName);
      await AsyncStorage.setItem('isAdmin', adminStatus ? 'true' : 'false');
    } catch (e) {
      console.log('Error saving storage', e);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('familyCode');
    await AsyncStorage.removeItem('userName');
    await AsyncStorage.removeItem('householdName');
    await AsyncStorage.removeItem('isAdmin');
    setFamilyCode('');
    setUserName('');
    setCurrentHouseholdName('');
    setIsAdmin(false);
    setMyHouseholds([]);
    setScreen('welcome');
  };

  const switchHousehold = async (code: string, hName: string, adminStatus: boolean) => {
    setFamilyCode(code);
    setCurrentHouseholdName(hName);
    setIsAdmin(adminStatus);
    await saveSession(code, userName, hName, adminStatus);
    setShowSwitchModal(false);
    setScreen('main');
  };

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
        completed: d.completed || false,
        householdCode: d.household_code,
        quantity: d.quantity || 1,
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
        householdCode: d.household_code,
      }));
      setMembers(formattedMembers);
    }
  };

  useEffect(() => {
    if (!familyCode) return;
    fetchItems();
    fetchMembers();
    fetchMyHouseholds(userName);

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, fetchItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, async () => {
        fetchMembers();
        await fetchMyHouseholds(userName);

        if (userName) {
          const cleanName = userName.trim();
          const { data: currentMemList } = await supabase
            .from('members')
            .select('status, is_admin')
            .eq('household_code', familyCode)
            .ilike('name', cleanName)
            .order('is_admin', { ascending: false });

          const adminMem = currentMemList?.find((m) => m.is_admin);
          const approvedMem = currentMemList?.find((m) => m.status === 'approved');

          if (adminMem || approvedMem) {
            const isAdm = !!adminMem || !!approvedMem?.is_admin;
            setIsAdmin(isAdm);
            await saveSession(familyCode, cleanName, currentHouseholdName, isAdm);
            setScreen('main');
          } else if (!currentMemList || currentMemList.length === 0) {
            setScreen('welcome');
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'households' }, async () => {
        await fetchMyHouseholds(userName);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyCode, userName]);

  const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const handleCreateHousehold = async () => {
    if (!userName.trim() || !householdNameInput.trim()) {
      showAlert('تنبيه', 'الرجاء إدخال اسمك واسم العائلة/المجموعة');
      return;
    }
    setLoading(true);
    try {
      const code = generateCode();
      const hName = householdNameInput.trim();
      const cleanName = userName.trim();

      const { error: hError } = await supabase.from('households').insert([
        { code: code, name: hName },
      ]);

      if (hError) {
        showAlert('خطأ', 'تعذر إنشاء المجموعة: ' + hError.message);
        return;
      }

      const { error: mError } = await supabase.from('members').insert([
        {
          household_code: code,
          name: cleanName,
          is_admin: true,
          status: 'approved',
        },
      ]);

      if (mError) {
        showAlert('خطأ في حفظ العضوية', mError.message);
        return;
      }

      setFamilyCode(code);
      setCurrentHouseholdName(hName);
      setIsAdmin(true);
      await saveSession(code, cleanName, hName, true);
      await fetchMyHouseholds(cleanName);
      setHouseholdNameInput('');
      setScreen('main');
    } catch (err: any) {
      showAlert('خطأ غير متوقع', err.message || 'تعذر الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinHousehold = async () => {
    const cleanName = userName.trim();
    const code = inputCode.toUpperCase().trim();

    if (!cleanName || !code) {
      showAlert('تنبيه', 'الرجاء إدخال الاسم ورمز العائلة');
      return;
    }

    setLoading(true);

    try {
      const { data: household } = await supabase
        .from('households')
        .select('code, name')
        .eq('code', code)
        .maybeSingle();

      if (!household) {
        showAlert('خطأ', 'رمز العائلة غير موجود، يرجى التأكد منه أو إنشاء عائلة جديدة.');
        return;
      }

      const fetchedHName = household.name || `عائلة (${code})`;

      const { data: existingMembers } = await supabase
        .from('members')
        .select('*')
        .eq('household_code', code)
        .ilike('name', cleanName);

      const adminRecord = existingMembers?.find((m) => m.is_admin);
      const approvedRecord = existingMembers?.find((m) => m.status === 'approved');

      if (adminRecord || approvedRecord) {
        const targetRecord = adminRecord || approvedRecord;
        const isAdm = !!adminRecord || !!targetRecord?.is_admin;

        const pendingIds = existingMembers?.filter((m) => m.status === 'pending').map((m) => m.id) || [];
        if (pendingIds.length > 0) {
          await supabase.from('members').delete().in('id', pendingIds);
        }

        setFamilyCode(code);
        setUserName(cleanName);
        setCurrentHouseholdName(fetchedHName);
        setIsAdmin(isAdm);

        await saveSession(code, cleanName, fetchedHName, isAdm);
        await fetchMyHouseholds(cleanName);
        setInputCode('');
        setScreen('main');
      } else if (existingMembers && existingMembers.length > 0) {
        setFamilyCode(code);
        setUserName(cleanName);
        setCurrentHouseholdName(fetchedHName);
        setIsAdmin(false);

        await saveSession(code, cleanName, fetchedHName, false);
        setInputCode('');
        setScreen('pending');
      } else {
        const { error: insertErr } = await supabase.from('members').insert([
          {
            household_code: code,
            name: cleanName,
            is_admin: false,
            status: 'pending',
          },
        ]);

        if (insertErr) {
          showAlert('خطأ في إرسال الطلب', insertErr.message);
          return;
        }

        setFamilyCode(code);
        setUserName(cleanName);
        setCurrentHouseholdName(fetchedHName);
        setIsAdmin(false);

        await saveSession(code, cleanName, fetchedHName, false);
        setInputCode('');
        setScreen('pending');
      }
    } catch (err: any) {
      showAlert('خطأ أثناء التنفيذ', err.message || 'حدثت مشكلة غير متوقعة أثناء الاتصال');
    } finally {
      setLoading(false);
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
        completed: false,
        quantity: 1,
      },
    ]);

    setNewItemText('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    fetchItems();
  };

  const updateQuantity = async (id: string, currentQty: number, delta: number) => {
    const newQty = currentQty + delta;
    if (newQty < 1) return;

    await supabase.from('items').update({ quantity: newQty }).eq('id', id);
    fetchItems();
  };

  const toggleItem = async (id: string, completed: boolean) => {
    await supabase.from('items').update({ completed: !completed }).eq('id', id);
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

  const rejectMember = async (id: string) => {
    await supabase.from('members').delete().eq('id', id);
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

          <TextInput
            style={styles.input}
            placeholder="اسم العائلة/المجموعة (مثال: بيت أبو المثنى)"
            value={householdNameInput}
            onChangeText={setHouseholdNameInput}
            textAlign="right"
          />

          <TextInput
            style={styles.input}
            placeholder="اسمك (مثال: أبو المثنى)"
            value={userName}
            onChangeText={setUserName}
            textAlign="right"
          />

          <TouchableOpacity
            style={[styles.primaryButton, loading && { opacity: 0.7 }]}
            onPress={handleCreateHousehold}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>إنشاء المجموعة</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen(familyCode ? 'main' : 'welcome')} style={styles.linkButton}>
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
          <TouchableOpacity
            style={[styles.primaryButton, loading && { opacity: 0.7 }]}
            onPress={handleJoinHousehold}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>دخول / إرسال طلب الانضمام</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen(familyCode ? 'main' : 'welcome')} style={styles.linkButton}>
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
            تم إرسال طلب انضمامك لـ "{currentHouseholdName}" (الرمز: {familyCode}). ستنفتح القائمة تلقائياً فور قبول المشرف.
          </Text>

          {myHouseholds.length > 0 && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                const firstGroup = myHouseholds[0];
                switchHousehold(firstGroup.household_code, firstGroup.household_name, firstGroup.is_admin);
              }}
            >
              <Text style={styles.secondaryButtonText}>الرجوع لمجموعاتك المفعلة</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handleLogout} style={styles.linkButton}>
            <Text style={styles.linkText}>تسجيل الخروج والرجوع</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>خروج</Text>
          </TouchableOpacity>

          {isAdmin && pendingMembers.length > 0 && (
            <TouchableOpacity onPress={() => setShowRequestsModal(true)} style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>الطلبات ({pendingMembers.length})</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setShowMembersModal(true)} style={styles.badge}>
            <Text style={styles.badgeText}>الأعضاء ({approvedMembers.length})</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => setShowSwitchModal(true)} style={{ alignItems: 'flex-end' }}>
          <Text style={styles.headerTitle}>{currentHouseholdName || 'قائمة العائلة'} ▾</Text>
          <Text style={styles.headerCode}>رمز الانضمام: {familyCode}</Text>
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

      {/* زر فتح نافذة المشاركة المباشرة */}
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TouchableOpacity style={styles.shareBannerBtn} onPress={handleOpenShare}>
          <Text style={styles.shareBannerText}>🔗 مشاركة رابط انضمام للعائلة</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hintText}>💡 اضغط على الغرض أو الاسم لنقله إلى قسم "تم شراؤها"</Text>

      <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
        {activeItems.map((item) => (
          <View key={item.id} style={styles.itemCard}>
            <TouchableOpacity
              style={styles.userColumn}
              onPress={() => toggleItem(item.id, item.completed)}
              activeOpacity={0.7}
            >
              <Text style={styles.itemUser} numberOfLines={1}>{item.addedBy}</Text>
            </TouchableOpacity>

            <Pressable style={styles.quantityColumn} onPress={() => {}}>
              <View style={styles.quantityBox}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQuantity(item.id, item.quantity, 1)}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>

                <Text style={styles.qtyText}>{item.quantity}</Text>

                <TouchableOpacity
                  style={[styles.qtyBtn, item.quantity <= 1 && styles.qtyBtnDisabled]}
                  onPress={() => updateQuantity(item.id, item.quantity, -1)}
                  disabled={item.quantity <= 1}
                >
                  <Text style={styles.qtyBtnText}>-</Text>
                </TouchableOpacity>
              </View>
            </Pressable>

            <TouchableOpacity
              style={styles.itemTextColumn}
              onPress={() => toggleItem(item.id, item.completed)}
              activeOpacity={0.7}
            >
              <Text style={styles.itemText} numberOfLines={1}>{item.text}</Text>
            </TouchableOpacity>
          </View>
        ))}

        {completedItems.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>تم شراؤها (انقر على الغرض لاستعادته)</Text>
            {completedItems.map((item) => (
              <View key={item.id} style={[styles.itemCard, styles.completedCard]}>
                <View style={styles.completedUserSection}>
                  <TouchableOpacity onPress={() => deleteItem(item.id)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 12 }}
                    onPress={() => toggleItem(item.id, item.completed)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.itemUser} numberOfLines={1}>{item.addedBy}</Text>
                  </TouchableOpacity>
                </View>

                <Pressable style={styles.quantityColumn} onPress={() => {}}>
                  <Text style={styles.qtyTextSimple}>الكمية: {item.quantity}</Text>
                </Pressable>

                <TouchableOpacity
                  style={styles.itemTextColumn}
                  onPress={() => toggleItem(item.id, item.completed)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.itemText, styles.completedText]} numberOfLines={1}>{item.text}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* نافذة المشاركة المخصصة المضمنة */}
      <Modal visible={showShareModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>مشاركة "{currentHouseholdName}"</Text>
            <Text style={{ textAlign: 'center', color: '#64748b', marginBottom: 12 }}>
              رمز الانضمام المباشر: <Text style={{ fontWeight: 'bold', color: '#16a34a' }}>{familyCode}</Text>
            </Text>

            <TextInput
              style={[styles.input, { fontSize: 13, color: '#334155', textAlign: 'left' }]}
              value={getShareUrl()}
              editable={false}
              selectTextOnFocus
            />

            <TouchableOpacity
              style={[styles.primaryButton, copied && { backgroundColor: '#059669' }]}
              onPress={handleCopyLink}
            >
              <Text style={styles.primaryButtonText}>
                {copied ? 'تم نسخ الرابط بنجاح! ✅' : 'نسخ الرابط 📋'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowShareModal(false)} style={styles.linkButton}>
              <Text style={[styles.linkText, { textAlign: 'center' }]}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* نافذة التبديل */}
      <Modal visible={showSwitchModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>مجموعاتي (العائلات)</Text>

            <ScrollView style={{ maxHeight: 220, marginBottom: 12 }}>
              {myHouseholds.length === 0 ? (
                <Text style={{ textAlign: 'center', color: '#64748b', marginVertical: 12 }}>
                  لا توجد مجموعات رئيسية أخرى مسجلة
                </Text>
              ) : (
                myHouseholds.map((h) => (
                  <TouchableOpacity
                    key={h.household_code}
                    style={[
                      styles.householdRow,
                      h.household_code === familyCode && styles.activeHouseholdRow,
                    ]}
                    onPress={() => switchHousehold(h.household_code, h.household_name, h.is_admin)}
                  >
                    <Text style={styles.roleTag}>{h.is_admin ? 'مدير' : 'عضو'}</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.householdNameText}>
                        {h.household_name} {h.household_code === familyCode ? '(الحالية)' : ''}
                      </Text>
                      <Text style={styles.householdCodeSubText}>الرمز: {h.household_code}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => { setShowSwitchModal(false); setScreen('join'); }}
            >
              <Text style={styles.primaryButtonText}>+ الانضمام لعائلة أخرى</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => { setShowSwitchModal(false); setScreen('create'); }}
            >
              <Text style={styles.secondaryButtonText}>+ إنشاء عائلة جديدة</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowSwitchModal(false)}
              style={styles.linkButton}
            >
              <Text style={[styles.linkText, { textAlign: 'center' }]}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showMembersModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>أعضاء ({currentHouseholdName})</Text>
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

      <Modal visible={showRequestsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>طلبات الانضمام المعلقة</Text>
            {pendingMembers.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => approveMember(m.id)} style={styles.approveBtn}>
                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>قبول</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => rejectMember(m.id)} style={styles.rejectBtn}>
                    <Text style={{ color: '#dc2626', fontWeight: 'bold' }}>رفض</Text>
                  </TouchableOpacity>
                </View>
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
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  input: { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16 },
  primaryButton: { width: '100%', backgroundColor: '#16a34a', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  secondaryButton: { width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  secondaryButtonText: { color: '#334155', fontSize: 15, fontWeight: '600' },
  linkButton: { marginTop: 14 },
  linkText: { color: '#64748b', fontSize: 14 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  headerCode: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginTop: 2 },
  badge: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, color: '#475569', fontWeight: 'bold' },
  alertBadge: { backgroundColor: '#fef2f2', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  alertBadgeText: { fontSize: 12, color: '#dc2626', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  logoutText: { fontSize: 12, color: '#dc2626', fontWeight: 'bold' },

  shareBannerBtn: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', padding: 10, borderRadius: 10, alignItems: 'center' },
  shareBannerText: { color: '#16a34a', fontWeight: 'bold', fontSize: 13 },

  inputContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 10 },
  mainInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14 },
  addButton: { backgroundColor: '#16a34a', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  hintText: { fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 12 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#64748b', marginTop: 20, marginBottom: 10, textAlign: 'right' },

  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    overflow: 'hidden',
  },

  itemTextColumn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingVertical: 12,
    paddingRight: 12,
  },
  itemText: { 
    fontSize: 16, 
    color: '#1e293b', 
    fontWeight: 'bold', 
    textAlign: 'right' 
  },

  userColumn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingLeft: 12,
  },
  itemUser: { 
    fontSize: 13, 
    color: '#64748b', 
    fontWeight: '500', 
    textAlign: 'left' 
  },

  quantityColumn: {
    width: 120,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  quantityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    gap: 6,
  },
  qtyBtn: {
    backgroundColor: '#16a34a',
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: {
    backgroundColor: '#cbd5e1',
  },
  qtyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  qtyText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#334155',
    minWidth: 16,
    textAlign: 'center',
  },

  completedCard: { backgroundColor: '#f8fafc', opacity: 0.7 },
  completedText: { textDecorationLine: 'line-through', color: '#94a3b8' },
  completedUserSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
  },
  qtyTextSimple: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  deleteBtn: { padding: 4, backgroundColor: '#fef2f2', borderRadius: 6 },
  deleteBtnText: { color: '#dc2626', fontWeight: 'bold', fontSize: 12 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  householdRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8, borderBottomWidth: 1, borderColor: '#f1f5f9', marginBottom: 6 },
  activeHouseholdRow: { backgroundColor: '#f0fdf4', borderColor: '#16a34a', borderWidth: 1 },
  householdNameText: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
  householdCodeSubText: { fontSize: 12, color: '#64748b', marginTop: 2 },
  memberName: { fontSize: 16, color: '#334155' },
  roleTag: { color: '#16a34a', fontWeight: 'bold' },
  approveBtn: { backgroundColor: '#16a34a', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  rejectBtn: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
});