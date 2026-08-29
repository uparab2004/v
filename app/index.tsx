import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NestableDraggableFlatList, NestableScrollContainer } from 'react-native-draggable-flatlist';
import {
  Alert,
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, CircleHelp, Clipboard, LogOut, Minus, Pencil, Plus, Users, X } from 'lucide-react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { PhoneLogin } from '../components/PhoneLogin';

I18nManager.allowRTL(true);

type Item = {
  id: string;
  name: string;
  quantity: number;
  addedBy: string;
  purchasedBy?: string;
  purchased: boolean;
  createdAt: string;
  version?: number;
};

type Group = { id: string; name: string; code: string; members: string[]; pending: string[]; manager: string };
type PendingJoin = { id: string; name: string; code: string; ownerName: string };
type SavedSession = { memberName: string; groups: Group[]; activeGroupId: string | null; pendingJoin: PendingJoin | null; personalOrders?: Record<string, string[]>; cachedItems?: Record<string, Item[]> };
type ItemOperationType = 'add' | 'quantity_delta' | 'set_purchased' | 'rename' | 'delete';
type PendingItemOperation = {
  id: string;
  groupId: string;
  actorName: string;
  type: ItemOperationType;
  itemId: string;
  payload: Record<string, string | number | boolean>;
  baseVersion?: number;
  createdAt: string;
};
type ItemSyncResult = {
  ok?: boolean;
  status?: 'applied' | 'noop' | 'rejected';
  reason?: string;
  duplicate?: boolean;
};
type LocalItemChange = { operation: PendingItemOperation; nextItems: Item[] };
type PersistedItemState = { queue: PendingItemOperation[]; cachedItems: Record<string, Item[]> };
const SESSION_KEY = '@maqadhi/session-v1';
const ITEM_QUEUE_KEY = '@maqadhi/item-queue-v1';
const PHONE_LOGIN_ENABLED = process.env.EXPO_PUBLIC_ENABLE_PHONE_LOGIN === 'true';

const createUuid = () => {
  const nativeUuid = globalThis.crypto?.randomUUID?.();
  if (nativeUuid) return nativeUuid;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const isNetworkFailure = (error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : String(error ?? '');
  return /network|fetch|timeout|offline|internet|connection/i.test(message);
};

const applyPendingOperations = (groupId: string, sourceItems: Item[], operations: PendingItemOperation[]) => {
  let merged = [...sourceItems];
  for (const operation of operations) {
    if (operation.groupId !== groupId) continue;
    if (operation.type === 'add') {
      if (!merged.some((item) => item.id === operation.itemId)) {
        merged.push({
          id: operation.itemId,
          name: String(operation.payload.name ?? ''),
          quantity: Number(operation.payload.quantity ?? 1),
          addedBy: operation.actorName,
          purchased: false,
          createdAt: String(operation.payload.createdAt ?? operation.createdAt),
          version: 1,
        });
      }
      continue;
    }
    if (operation.type === 'delete') {
      merged = merged.filter((item) => item.id !== operation.itemId);
      continue;
    }
    merged = merged.map((item) => {
      if (item.id !== operation.itemId) return item;
      if (operation.type === 'quantity_delta') {
        return {
          ...item,
          quantity: Math.max(1, item.quantity + Number(operation.payload.delta ?? 0)),
          version: (item.version ?? 0) + 1,
        };
      }
      if (operation.type === 'set_purchased') {
        const purchased = Boolean(operation.payload.purchased);
        return {
          ...item,
          purchased,
          purchasedBy: purchased ? String(operation.payload.purchasedBy ?? operation.actorName) : undefined,
          version: (item.version ?? 0) + 1,
        };
      }
      if (operation.type === 'rename') {
        return { ...item, name: String(operation.payload.name ?? item.name), version: (item.version ?? 0) + 1 };
      }
      return item;
    });
  }
  return merged;
};

export default function MaqadhiHome() {
  const { code: linkedCode } = useLocalSearchParams<{ code?: string }>();
  const [groupList, setGroupList] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [personalOrders, setPersonalOrders] = useState<Record<string, string[]>>({});
  const [cachedItems, setCachedItems] = useState<Record<string, Item[]>>({});
  const [pendingItemOperations, setPendingItemOperations] = useState<PendingItemOperation[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [newItem, setNewItem] = useState('');
  const [groupsVisible, setGroupsVisible] = useState(false);
  const [requestsVisible, setRequestsVisible] = useState(false);
  const [membersVisible, setMembersVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [exitVisible, setExitVisible] = useState(false);
  const [exitRequiresManager, setExitRequiresManager] = useState(false);
  const [groupAction, setGroupAction] = useState<'create' | 'join' | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [memberName, setMemberName] = useState('');
  const [pendingJoin, setPendingJoin] = useState<PendingJoin | null>(null);
  const [actionError, setActionError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [notice, setNotice] = useState('');
  const [authReady, setAuthReady] = useState(!PHONE_LOGIN_ENABLED);
  const [authenticated, setAuthenticated] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const itemQueueRef = useRef<PendingItemOperation[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const cachedItemsRef = useRef<Record<string, Item[]>>({});
  const activeGroupIdRef = useRef<string | null>(null);
  const queueMutationRef = useRef<Promise<void>>(Promise.resolve());
  const localItemMutationRef = useRef<Promise<void>>(Promise.resolve());
  const flushingItemQueuePromiseRef = useRef<Promise<void> | null>(null);
  const offlineSyncNoticeShownRef = useRef(false);
  const currentUser = memberName.trim();

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const [stored, storedQueue] = await Promise.all([
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(ITEM_QUEUE_KEY),
        ]);
        const persistedItemState: unknown = storedQueue ? JSON.parse(storedQueue) : [];
        const hasOfflineSnapshot = !Array.isArray(persistedItemState)
          && typeof persistedItemState === 'object'
          && persistedItemState !== null
          && 'cachedItems' in persistedItemState;
        const savedQueue = Array.isArray(persistedItemState)
          ? persistedItemState as PendingItemOperation[]
          : hasOfflineSnapshot && Array.isArray((persistedItemState as PersistedItemState).queue)
            ? (persistedItemState as PersistedItemState).queue
            : [];
        const offlineCachedItems = hasOfflineSnapshot
          && typeof (persistedItemState as PersistedItemState).cachedItems === 'object'
          && (persistedItemState as PersistedItemState).cachedItems !== null
          ? (persistedItemState as PersistedItemState).cachedItems
          : {};
        itemQueueRef.current = savedQueue;
        setPendingItemOperations(savedQueue);
        if (!stored || !active) return;
        const session = JSON.parse(stored) as SavedSession;
        const groups = Array.isArray(session.groups) ? session.groups : [];
        setMemberName(typeof session.memberName === 'string' ? session.memberName : '');
        setGroupList(groups);
        setPendingJoin(session.pendingJoin ?? null);
        setPersonalOrders(session.personalOrders && typeof session.personalOrders === 'object' ? session.personalOrders : {});
        const sessionItems = session.cachedItems && typeof session.cachedItems === 'object' ? session.cachedItems : {};
        const savedItems = { ...sessionItems, ...offlineCachedItems };
        const restoredGroup = groups.find((group) => group.id === session.activeGroupId);
        const restoredItemsByGroup = hasOfflineSnapshot
          ? savedItems
          : groups.reduce<Record<string, Item[]>>((result, group) => ({
            ...result,
            [group.id]: applyPendingOperations(group.id, savedItems[group.id] ?? [], savedQueue),
          }), savedItems);
        if (restoredGroup) {
          const restoredItems = Array.isArray(restoredItemsByGroup[restoredGroup.id])
            ? restoredItemsByGroup[restoredGroup.id]
            : [];
          activeGroupIdRef.current = restoredGroup.id;
          itemsRef.current = restoredItems;
          setActiveGroup(restoredGroup);
          setItems(restoredItems);
        }
        cachedItemsRef.current = restoredItemsByGroup;
        setCachedItems(restoredItemsByGroup);
        if (!hasOfflineSnapshot) {
          try {
            const migratedState: PersistedItemState = { queue: savedQueue, cachedItems: restoredItemsByGroup };
            await AsyncStorage.setItem(ITEM_QUEUE_KEY, JSON.stringify(migratedState));
          } catch {
            // تبقى بيانات الجلسة القديمة قابلة للاستخدام حتى تنجح الكتابة في المرة التالية.
          }
        }
      } catch {
        // تجاهل أي بيانات محفوظة تالفة وفتح شاشة البداية.
      } finally {
        if (active) setSessionReady(true);
      }
    };
    void restoreSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    itemQueueRef.current = pendingItemOperations;
  }, [pendingItemOperations]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    cachedItemsRef.current = cachedItems;
  }, [cachedItems]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroup?.id ?? null;
  }, [activeGroup?.id]);

  useEffect(() => {
    if (!PHONE_LOGIN_ENABLED) return;
    let active = true;
    const applySession = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      if (!active) return;
      setAuthenticated(Boolean(session));
      const displayName = session?.user.user_metadata?.display_name;
      if (typeof displayName === 'string' && displayName.trim()) {
        setMemberName((current) => current || displayName.trim());
      }
      setAuthReady(true);
    };
    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const session: SavedSession = {
      memberName,
      groups: groupList,
      activeGroupId: activeGroup?.id ?? null,
      pendingJoin,
      personalOrders,
      cachedItems,
    };
    void AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [sessionReady, memberName, groupList, activeGroup?.id, pendingJoin, personalOrders, cachedItems]);

  useEffect(() => {
    if (!activeGroup) return;
    const groupItems = cachedItemsRef.current[activeGroup.id] ?? [];
    itemsRef.current = groupItems;
    setItems(groupItems);
  }, [activeGroup?.id]);

  const persistOfflineItemState = async (
    nextQueue: PendingItemOperation[],
    nextCachedItems: Record<string, Item[]> = cachedItemsRef.current,
  ) => {
    // الطابور والقائمة يُحفظان في سجل واحد حتى لا يظهر تغيير ناقص بعد إعادة فتح التطبيق.
    const persistedState: PersistedItemState = { queue: nextQueue, cachedItems: nextCachedItems };
    await AsyncStorage.setItem(ITEM_QUEUE_KEY, JSON.stringify(persistedState));
    itemQueueRef.current = nextQueue;
    cachedItemsRef.current = nextCachedItems;
    setPendingItemOperations(nextQueue);
    setCachedItems(nextCachedItems);
  };

  const mutateItemQueue = (
    update: (current: PendingItemOperation[]) => PendingItemOperation[],
    nextCachedItems?: Record<string, Item[]>,
  ) => {
    const mutation = queueMutationRef.current.then(async () => {
      await persistOfflineItemState(update(itemQueueRef.current), nextCachedItems ?? cachedItemsRef.current);
    });
    queueMutationRef.current = mutation.catch(() => undefined);
    return mutation;
  };

  const enqueueItemOperation = (
    operation: PendingItemOperation,
    nextCachedItems: Record<string, Item[]>,
  ) => (
    mutateItemQueue((current) => [...current, operation], nextCachedItems)
  );

  const removeQueuedItemOperation = (operationId: string) => (
    mutateItemQueue((current) => current.filter((entry) => entry.id !== operationId))
  );

  const flushPendingItemOperations = () => {
    if (flushingItemQueuePromiseRef.current) return flushingItemQueuePromiseRef.current;
    if (!itemQueueRef.current.length) return Promise.resolve();

    const run = (async () => {
      try {
        while (itemQueueRef.current.length) {
          const operation = itemQueueRef.current[0];
          let data: ItemSyncResult | null = null;
          let error: { code?: string; message?: string } | null = null;
          try {
            const result = await supabase.rpc('maqadhi_v2_apply_item_operation', {
              p_operation_id: operation.id,
              p_group_id: operation.groupId,
              p_actor_name: operation.actorName,
              p_operation_type: operation.type,
              p_item_id: operation.itemId,
              p_payload: operation.payload,
              p_base_version: operation.baseVersion ?? null,
              p_client_created_at: operation.createdAt,
            });
            data = result.data as ItemSyncResult | null;
            error = result.error;
          } catch (requestError) {
            error = { message: requestError instanceof Error ? requestError.message : 'تعذر الاتصال' };
          }

          if (error) {
            if (isNetworkFailure(error)) {
              if (!offlineSyncNoticeShownRef.current) {
                offlineSyncNoticeShownRef.current = true;
                setNotice('تم حفظ تغييراتك على الجهاز، وستُرسل تلقائيًا عند عودة الإنترنت.');
              }
            } else if (error.code !== 'PGRST202') {
              setNotice('تعذر إرسال تغيير محفوظ. سيبقى على جهازك حتى تنجح المزامنة.');
            }
            break;
          }

          if (!data?.ok) {
            await removeQueuedItemOperation(operation.id);
            const reason = data?.reason === 'stale_version'
              ? 'تغيّر هذا الغرض من جهاز آخر، فتم اعتماد آخر نسخة محفوظة.'
              : data?.reason === 'item_deleted' || data?.reason === 'item_missing'
                ? 'حُذف هذا الغرض من جهاز آخر قبل مزامنة التغيير.'
                : 'تعذر تطبيق تغيير محفوظ لأن بيانات المجموعة تغيّرت.';
            setNotice(reason);
            continue;
          }

          offlineSyncNoticeShownRef.current = false;
          await removeQueuedItemOperation(operation.id);
        }
      } catch {
        setNotice('تعذر تحديث قائمة التغييرات المحفوظة على الجهاز. ستتم المحاولة مرة أخرى.');
      } finally {
        flushingItemQueuePromiseRef.current = null;
      }
    })();
    flushingItemQueuePromiseRef.current = run;
    return run;
  };

  const refreshItems = async (groupId: string) => {
    // محاولة الإرسال أولًا تمنع احتساب عملية وصلت للخادم مرتين عند انقطاع الرد.
    await flushPendingItemOperations();
    const baseColumns = 'id, name, quantity, added_by, purchased, purchased_by, created_at';
    const responseWithVersion = await supabase
      .from('maqadhi_v2_items')
      .select(`${baseColumns}, version`)
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });
    let data: unknown = responseWithVersion.data;
    let error: { message: string } | null = responseWithVersion.error;
    if (error && /version|column/i.test(error.message)) {
      const fallbackResponse = await supabase
        .from('maqadhi_v2_items')
        .select(baseColumns)
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });
      data = fallbackResponse.data;
      error = fallbackResponse.error;
    }
    if (error || !data) return;
    const mappedItems: Item[] = (data as Array<{
      id: string;
      name: string;
      quantity: number;
      added_by: string;
      purchased: boolean;
      purchased_by: string | null;
      created_at: string;
      version?: number;
    }>).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      addedBy: item.added_by,
      purchased: item.purchased,
      purchasedBy: item.purchased_by ?? undefined,
      createdAt: item.created_at,
      version: typeof item.version === 'number' ? item.version : 0,
    }));
    const commit = localItemMutationRef.current.then(async () => {
      const pendingItems = applyPendingOperations(groupId, mappedItems, itemQueueRef.current);
      const order = personalOrders[groupId] ?? [];
      const positions = new Map(order.map((id, index) => [id, index]));
      pendingItems.sort((first, second) => {
        const firstPosition = positions.get(first.id);
        const secondPosition = positions.get(second.id);
        if (firstPosition === undefined && secondPosition === undefined) return 0;
        if (firstPosition === undefined) return 1;
        if (secondPosition === undefined) return -1;
        return firstPosition - secondPosition;
      });
      cachedItemsRef.current = { ...cachedItemsRef.current, [groupId]: pendingItems };
      setCachedItems(cachedItemsRef.current);
      if (activeGroupIdRef.current === groupId) {
        itemsRef.current = pendingItems;
        setItems(pendingItems);
      }
      await mutateItemQueue((current) => current);
    });
    localItemMutationRef.current = commit.then(() => undefined, () => undefined);
    await commit;
  };

  useEffect(() => {
    if (!sessionReady || !pendingItemOperations.length) return;
    void flushPendingItemOperations();
    const timer = setInterval(() => void flushPendingItemOperations(), 5000);
    return () => clearInterval(timer);
  }, [sessionReady, pendingItemOperations.length]);

  const applyLocalItemChange = (
    groupId: string,
    buildChange: (currentItems: Item[]) => LocalItemChange | null,
  ) => {
    const task = localItemMutationRef.current.then(async () => {
      const currentItems = cachedItemsRef.current[groupId]
        ?? (activeGroupIdRef.current === groupId ? itemsRef.current : []);
      const change = buildChange(currentItems);
      if (!change) return false;
      const nextCachedItems = { ...cachedItemsRef.current, [groupId]: change.nextItems };
      try {
        // نحفظ العملية أولًا حتى لا تضيع إن أُغلق التطبيق مباشرة بعد الضغط.
        await enqueueItemOperation(change.operation, nextCachedItems);
      } catch {
        setNotice('تعذر حفظ التغيير على الجهاز. حاول مرة أخرى.');
        return false;
      }
      if (activeGroupIdRef.current === groupId) {
        itemsRef.current = change.nextItems;
        setItems(change.nextItems);
      }
      void flushPendingItemOperations();
      return true;
    });
    localItemMutationRef.current = task.then(() => undefined, () => undefined);
    return task;
  };

  const addItem = async () => {
    const name = newItem.trim();
    if (!name || !currentUser || !activeGroup) return;
    const createdAt = new Date().toISOString();
    const groupId = activeGroup.id;
    const localItem: Item = {
      id: createUuid(),
      name,
      quantity: 1,
      addedBy: currentUser,
      purchased: false,
      createdAt,
      version: 1,
    };
    const saved = await applyLocalItemChange(groupId, (currentItems) => ({
      operation: {
        id: createUuid(),
        groupId,
        actorName: currentUser,
        type: 'add',
        itemId: localItem.id,
        payload: { name, quantity: 1, createdAt },
        createdAt,
      },
      nextItems: [...currentItems, localItem],
    }));
    if (!saved) return;
    setNewItem('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const changeQuantity = async (id: string, amount: number) => {
    if (!activeGroup || !currentUser) return;
    const groupId = activeGroup.id;
    await applyLocalItemChange(groupId, (currentItems) => {
      const item = currentItems.find((entry) => entry.id === id);
      if (!item) return null;
      const nextQuantity = Math.max(1, item.quantity + amount);
      const delta = nextQuantity - item.quantity;
      if (!delta) return null;
      const createdAt = new Date().toISOString();
      return {
        operation: {
          id: createUuid(),
          groupId,
          actorName: currentUser,
          type: 'quantity_delta',
          itemId: id,
          payload: { delta },
          baseVersion: item.version ?? 0,
          createdAt,
        },
        nextItems: currentItems.map((entry) => entry.id === id
          ? { ...entry, quantity: nextQuantity, version: (entry.version ?? 0) + 1 }
          : entry),
      };
    });
  };

  const togglePurchased = async (id: string) => {
    if (!activeGroup || !currentUser) return;
    const groupId = activeGroup.id;
    await applyLocalItemChange(groupId, (currentItems) => {
      const item = currentItems.find((entry) => entry.id === id);
      if (!item) return null;
      const nextPurchased = !item.purchased;
      const createdAt = new Date().toISOString();
      return {
        operation: {
          id: createUuid(),
          groupId,
          actorName: currentUser,
          type: 'set_purchased',
          itemId: id,
          payload: { purchased: nextPurchased, purchasedBy: currentUser },
          baseVersion: item.version ?? 0,
          createdAt,
        },
        nextItems: currentItems.map((entry) => entry.id === id
          ? {
            ...entry,
            purchased: nextPurchased,
            purchasedBy: nextPurchased ? currentUser : undefined,
            version: (entry.version ?? 0) + 1,
          }
          : entry),
      };
    });
  };

  const removeItem = async (id: string) => {
    if (!activeGroup || !currentUser) return;
    const groupId = activeGroup.id;
    const manager = activeGroup.manager;
    const saved = await applyLocalItemChange(groupId, (currentItems) => {
      const item = currentItems.find((entry) => entry.id === id);
      if (!item || !item.purchased || (manager !== currentUser && item.addedBy !== currentUser)) {
        setNotice('ليس لديك صلاحية حذف هذا الغرض.');
        return null;
      }
      const createdAt = new Date().toISOString();
      return {
        operation: {
          id: createUuid(),
          groupId,
          actorName: currentUser,
          type: 'delete',
          itemId: id,
          payload: {},
          baseVersion: item.version ?? 0,
          createdAt,
        },
        nextItems: currentItems.filter((entry) => entry.id !== id),
      };
    });
    if (saved) {
      setPersonalOrders((current) => ({
        ...current,
        [groupId]: (current[groupId] ?? []).filter((itemId) => itemId !== id),
      }));
    }
  };

  const saveItemName = async () => {
    const name = editedName.trim();
    const itemId = editingId;
    if (!itemId || !name || !activeGroup || !currentUser) return;
    const groupId = activeGroup.id;
    const saved = await applyLocalItemChange(groupId, (currentItems) => {
      const item = currentItems.find((entry) => entry.id === itemId);
      if (!item) return null;
      const createdAt = new Date().toISOString();
      return {
        operation: {
          id: createUuid(),
          groupId,
          actorName: currentUser,
          type: 'rename',
          itemId,
          payload: { name },
          baseVersion: item.version ?? 0,
          createdAt,
        },
        nextItems: currentItems.map((entry) => entry.id === itemId
          ? { ...entry, name, version: (entry.version ?? 0) + 1 }
          : entry),
      };
    });
    if (saved) setEditingId(null);
  };

  const saveWantedOrder = (orderedItems: Item[]) => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const task = localItemMutationRef.current.then(async () => {
      const currentGroupItems = cachedItemsRef.current[groupId] ?? itemsRef.current;
      const orderedIds = new Set(orderedItems.map((item) => item.id));
      const currentWantedById = new Map(currentGroupItems.filter((item) => !item.purchased).map((item) => [item.id, item]));
      const latestOrderedItems = orderedItems
        .map((item) => currentWantedById.get(item.id))
        .filter((item): item is Item => Boolean(item));
      const newlyAddedItems = currentGroupItems.filter((item) => !item.purchased && !orderedIds.has(item.id));
      const orderedWithPurchased = [
        ...latestOrderedItems,
        ...newlyAddedItems,
        ...currentGroupItems.filter((item) => item.purchased),
      ];
      itemsRef.current = orderedWithPurchased;
      setItems(orderedWithPurchased);
      cachedItemsRef.current = { ...cachedItemsRef.current, [groupId]: orderedWithPurchased };
      setCachedItems(cachedItemsRef.current);
      setPersonalOrders((current) => ({ ...current, [groupId]: [...latestOrderedItems, ...newlyAddedItems].map((item) => item.id) }));
      await mutateItemQueue((current) => current);
    });
    localItemMutationRef.current = task.then(() => undefined, () => undefined);
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
    void refreshItems(activeGroup.id);
    const timer = setInterval(() => {
      void refreshMembers(activeGroup.id);
      void refreshItems(activeGroup.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [activeGroup?.id, personalOrders]);

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

  useEffect(() => {
    if (!sessionReady || activeGroup || pendingJoin || typeof linkedCode !== 'string' || !/^[A-Z0-9]{6}$/i.test(linkedCode)) return;
    setJoinCode(linkedCode.toUpperCase());
    setGroupAction('join');
    setActionError('');
  }, [sessionReady, linkedCode, activeGroup, pendingJoin]);

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
  const leaveAsMember = async () => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const { error } = await supabase.from('maqadhi_v2_members').delete().eq('group_id', groupId).eq('name', currentUser);
    if (error) {
      setNotice('تعذر إتمام المغادرة. حاول مرة أخرى.');
      return;
    }
    setExitVisible(false);
    const remaining = groupList.filter((group) => group.id !== groupId);
    setGroupList(remaining);
    setActiveGroup(remaining[0] ?? null);
    setItems([]);
    setNotice('');
  };

  const openExitDialog = async () => {
    if (!activeGroup) return;
    const { data } = await supabase
      .from('maqadhi_v2_members')
      .select('name')
      .eq('group_id', activeGroup.id)
      .eq('role', 'manager')
      .eq('status', 'approved')
      .maybeSingle();
    const manager = data?.name ?? activeGroup.manager;
    setExitRequiresManager(manager === currentUser);
    if (manager !== activeGroup.manager) {
      setActiveGroup((current) => current?.id === activeGroup.id ? { ...current, manager } : current);
      setGroupList((current) => current.map((group) => group.id === activeGroup.id ? { ...group, manager } : group));
    }
    setExitVisible(true);
  };

  const leaveGroup = async (nextManager: string) => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const { data: managerRecord } = await supabase
      .from('maqadhi_v2_members')
      .select('name')
      .eq('group_id', groupId)
      .eq('role', 'manager')
      .eq('status', 'approved')
      .maybeSingle();
    if (managerRecord?.name !== currentUser) {
      await leaveAsMember();
      return;
    }
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
  const groupLink = activeGroup ? Linking.createURL('/', { queryParams: { code: activeGroup.code } }) : '';
  const shareLink = async () => {
    await Share.share({ title: 'رابط الانضمام إلى مجموعة مقاضي', message: `انضم إلى مجموعة «${activeGroup?.name}» عبر الرابط التالي:\n${groupLink}` });
  };
  const requestedCount = activeGroup?.pending.length ?? 0;
  const wanted = items.filter((item) => !item.purchased);
  const bought = items.filter((item) => item.purchased);

  if (PHONE_LOGIN_ENABLED && (!authReady || !authenticated)) {
    return <PhoneLogin onAuthenticated={() => setAuthenticated(true)} />;
  }

  if (!sessionReady) {
    return <View style={styles.welcomeScreen}><Text style={styles.welcomeText}>جار استعادة حسابك...</Text></View>;
  }

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
      <KeyboardAvoidingView style={styles.keyboardContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <NestableScrollContainer contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
            <TouchableOpacity style={styles.exitAction} onPress={() => void openExitDialog()}>
              <LogOut color={colors.danger} size={18} />
              <Text style={styles.exitText}>خروج</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.infoAction} onPress={() => setInfoVisible(true)} accessibilityLabel="نبذة عن التطبيق">
              <CircleHelp color={colors.muted} size={21} />
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
        <Text style={styles.hint}>اضغط على الغرض لنقله إلى قسم «تم شراؤه»، واضغط مطولًا لسحبه وترتيبه</Text>

        <Text style={styles.sectionTitle}>المطلوب شراؤه ({wanted.length})</Text>
        <NestableDraggableFlatList
          data={wanted}
          keyExtractor={(item) => item.id}
          activationDistance={12}
          onDragEnd={({ data }) => saveWantedOrder(data)}
          renderItem={({ item, drag, isActive }) => <ShoppingRow item={item} currentUser={currentUser} canManage={isCurrentUserManager} onToggle={togglePurchased} onLongPress={drag} isDragging={isActive} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />}
        />

        {bought.length > 0 && <View style={styles.divider} />}
        {bought.length > 0 && <Text style={styles.sectionTitle}>تم شراؤه ({bought.length})</Text>}
        {bought.map((item) => (
          <ShoppingRow key={item.id} item={item} currentUser={currentUser} canManage={isCurrentUserManager} onToggle={togglePurchased} onQuantity={changeQuantity} onDelete={removeItem} editingId={editingId} editedName={editedName} onEdit={(entry) => { setEditingId(entry.id); setEditedName(entry.name); }} onEditedName={setEditedName} onSave={saveItemName} />
        ))}
      </NestableScrollContainer>
      </KeyboardAvoidingView>

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
            <Text style={styles.modalHint}>أرسل الرابط لمن تريد إضافته إلى المجموعة.</Text>
            <Text style={styles.groupLink} selectable>{groupLink}</Text>
            <TouchableOpacity style={styles.primaryModalButton} onPress={shareLink}><Text style={styles.primaryModalText}>مشاركة الرابط</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShareVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setInfoVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>عن مقاضي</Text>
            <Text style={styles.infoText}>مقاضي يساعد العائلة أو فريق العمل على مشاركة قائمة الاحتياجات ومعرفة ما تم شراؤه.</Text>
            <Text style={styles.infoText}>أضف غرضًا، عدّل الكمية عند الحاجة، واضغط على الغرض عند شرائه لنقله إلى قسم «تم شراؤه».</Text>
            <Text style={styles.infoLabel}>الخصوصية</Text>
            <Text style={styles.infoText}>تُحفظ أسماء الأعضاء والمجموعات والأغراض لتقديم خدمة المشاركة والمزامنة، ولا يعرض التطبيق إعلانات ولا يبيع بيانات المستخدمين.</Text>
            <Text style={styles.infoLabel}>للتواصل والاقتراحات</Text>
            <Text style={styles.infoEmail} selectable>uparab2004@gmail.com</Text>
            <TouchableOpacity onPress={() => setInfoVisible(false)}><Text style={styles.closeText}>إغلاق</Text></TouchableOpacity>
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
            {exitRequiresManager ? <>
              <Text style={styles.modalTitle}>{otherMembers.length ? 'تعيين مدير بديل' : 'مغادرة المجموعة'}</Text>
              {otherMembers.length ? <Text style={styles.modalHint}>اختر مديرًا للمجموعة قبل مغادرتك.</Text> : <Text style={styles.modalHint}>أنت العضو الوحيد. ستُحذف المجموعة عند مغادرتك.</Text>}
              {otherMembers.map((name) => <TouchableOpacity key={name} style={styles.managerChoice} onPress={() => leaveGroup(name)}><Text style={styles.memberName}>{name}</Text><Text style={styles.chooseText}>تعيين مدير</Text></TouchableOpacity>)}
              {!otherMembers.length && <TouchableOpacity style={styles.deleteGroupButton} onPress={deleteCurrentGroup}><Text style={styles.deleteGroupText}>حذف المجموعة والمغادرة</Text></TouchableOpacity>}
            </> : <>
              <Text style={styles.modalTitle}>مغادرة المجموعة</Text>
              <Text style={styles.modalHint}>هل تريد مغادرة هذه المجموعة؟</Text>
              <TouchableOpacity style={styles.deleteGroupButton} onPress={() => void leaveAsMember()}><Text style={styles.deleteGroupText}>مغادرة المجموعة</Text></TouchableOpacity>
            </>}
            <TouchableOpacity onPress={() => setExitVisible(false)}><Text style={styles.closeText}>إلغاء</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ShoppingRow({ item, currentUser, canManage, onToggle, onLongPress, isDragging, onQuantity, onDelete, editingId, editedName, onEdit, onEditedName, onSave }: { item: Item; currentUser: string; canManage: boolean; onToggle: (id: string) => void; onLongPress?: () => void; isDragging?: boolean; onQuantity: (id: string, amount: number) => void; onDelete: (id: string) => void; editingId: string | null; editedName: string; onEdit: (item: Item) => void; onEditedName: (name: string) => void; onSave: () => void }) {
  const isEditing = editingId === item.id;
  const canEdit = item.addedBy === currentUser;
  const itemNameSize = item.name.length > 32 ? 14 : item.name.length > 20 ? 15 : 16;
  return (
    <View style={[styles.itemRow, item.purchased && styles.purchasedRow, isDragging && styles.draggingRow]}>
      {isEditing ? (
        <View style={styles.itemTap}>
          <TextInput value={editedName} onChangeText={onEditedName} onSubmitEditing={onSave} autoFocus selectTextOnFocus textAlign="right" style={styles.inlineEdit} />
          <TouchableOpacity style={styles.editButton} onPress={onSave}><Text style={styles.editButtonText}>حفظ</Text></TouchableOpacity>
        </View>
      ) : (
      <TouchableOpacity style={[styles.itemTap, styles.itemTapWide]} onPress={() => onToggle(item.id)} onLongPress={onLongPress} activeOpacity={0.7}>
        <Text style={[styles.itemName, { fontSize: itemNameSize }, item.purchased && styles.purchasedName]}>{item.name}</Text>
      </TouchableOpacity>
      )}
      <View style={styles.quantity}>
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, 1)}><Plus size={17} color={colors.primary} /></TouchableOpacity>
        <Text style={styles.quantityValue}>{item.quantity}</Text>
        <TouchableOpacity style={styles.quantityButton} onPress={() => onQuantity(item.id, -1)}><Minus size={17} color={colors.primary} /></TouchableOpacity>
      </View>
      {!isEditing && <View style={[styles.addedBy, styles.addedByNarrow]}>
        <TouchableOpacity style={styles.addedInfoTap} onPress={() => onToggle(item.id)} onLongPress={onLongPress} activeOpacity={0.7}>
          <Text numberOfLines={1} style={styles.meta}>أضافه: {item.addedBy}</Text>
          {item.purchasedBy && <Text numberOfLines={1} style={styles.meta}>اشتراه: {item.purchasedBy}</Text>}
        </TouchableOpacity>
        {canEdit && !item.purchased && <TouchableOpacity onPress={() => onEdit(item)}><Text style={styles.editText}>تعديل</Text></TouchableOpacity>}
      </View>}
      {item.purchased && (canManage || canEdit) && <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(item.id)}><X size={18} color={colors.danger} /></TouchableOpacity>}
    </View>
  );
}

const colors = { primary: '#159447', primaryLight: '#edfaf1', text: '#202124', muted: '#65706a', placeholder: '#9aa19d', border: '#e3e7e4', danger: '#ca4848', gray: '#f1f3f2' };
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, keyboardContainer: { flex: 1 }, content: { padding: 20, paddingTop: 30, paddingBottom: 52 }, welcomeScreen: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 28 }, welcomeContent: { alignItems: 'stretch' }, waitingCard: { alignItems: 'stretch', borderWidth: 1, borderColor: '#dce9e0', borderRadius: 22, padding: 24, backgroundColor: '#fff' }, waitingIcon: { color: colors.primary, fontSize: 54, textAlign: 'center', marginBottom: 6 }, welcomeTitle: { color: colors.text, fontSize: 34, fontWeight: '800', textAlign: 'center' }, welcomeText: { color: colors.muted, textAlign: 'center', fontSize: 16, lineHeight: 25, marginTop: 12, marginBottom: 24 }, waitingText: { color: colors.primary, textAlign: 'center', fontSize: 14, lineHeight: 22, fontWeight: '700' }, welcomePrimary: { height: 58, backgroundColor: colors.primary, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, welcomePrimaryText: { color: '#fff', fontSize: 18, fontWeight: '800' }, welcomeSecondary: { height: 58, borderWidth: 1, borderColor: '#cde5d6', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 20 }, welcomeSecondaryText: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  topBar: { gap: 14, borderBottomWidth: 1, borderBottomColor: '#eff1ef', paddingBottom: 15 }, groupTrigger: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 7 }, groupOverline: { color: colors.muted, fontSize: 12 }, groupName: { color: colors.text, fontWeight: '800', fontSize: 24 }, topActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, roundAction: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, backgroundColor: '#f5f7f6' }, actionText: { color: colors.muted, fontSize: 13, fontWeight: '700' }, requestsAction: { backgroundColor: '#fff1f1' }, requestsText: { color: '#b84a4a', fontWeight: '700', fontSize: 13 }, exitAction: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 7 }, exitText: { color: colors.danger, fontWeight: '700', fontSize: 13 }, infoAction: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7f6' },
  code: { marginTop: 11, color: colors.primary, fontSize: 14, fontWeight: '700' }, codeValue: { letterSpacing: 1.3 }, notice: { marginTop: 9, color: colors.primary, fontWeight: '700', fontSize: 12, textAlign: 'right' }, addRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 25, alignItems: 'center' }, input: { flex: 1, borderWidth: 1, borderColor: '#d9dedb', borderRadius: 13, height: 48, paddingHorizontal: 15, color: colors.text, fontSize: 16 }, addButton: { height: 48, paddingHorizontal: 22, borderRadius: 13, backgroundColor: colors.primary, justifyContent: 'center' }, addButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  shareButton: { marginTop: 12, height: 48, borderRadius: 13, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#c8ecd5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, shareText: { color: '#207144', fontWeight: '700', fontSize: 15 }, hint: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 13, marginBottom: 21 }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  itemRow: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 7, paddingVertical: 5, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff' }, draggingRow: { opacity: 0.75, borderColor: colors.primary, backgroundColor: colors.primaryLight }, purchasedRow: { backgroundColor: colors.gray, borderColor: '#e5e8e6' }, itemTap: { flex: 1, minWidth: 0, alignItems: 'flex-start', justifyContent: 'center' }, itemName: { maxWidth: '100%', color: colors.text, fontWeight: '800', fontSize: 16, textAlign: 'right', alignSelf: 'flex-start' }, purchasedName: { color: '#7c8580', textDecorationLine: 'line-through' }, addedBy: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2 }, addedInfoTap: { alignSelf: 'stretch', alignItems: 'center' }, meta: { color: colors.muted, fontSize: 10, textAlign: 'center' }, editText: { color: colors.primary, fontSize: 10, fontWeight: '800', textAlign: 'center' }, inlineEdit: { width: '100%', borderWidth: 1, borderColor: '#bde3cb', borderRadius: 8, height: 42, paddingHorizontal: 11, paddingVertical: 0, color: colors.text, fontSize: 16, textAlign: 'right', writingDirection: 'rtl', includeFontPadding: false }, editButton: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.primaryLight, borderRadius: 7, paddingVertical: 6, paddingHorizontal: 14 }, editButtonText: { color: colors.primary, fontWeight: '800', fontSize: 12 }, quantity: { width: 110, direction: 'ltr', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, quantityButton: { width: 29, height: 29, borderRadius: 7, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, quantityValue: { color: colors.text, fontWeight: '800', fontSize: 16, minWidth: 17, textAlign: 'center' }, deleteButton: { padding: 4 }, divider: { height: 1, backgroundColor: '#e8ebe9', marginVertical: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end', padding: 16 }, sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 11 }, modalTitle: { color: colors.text, fontWeight: '800', fontSize: 21, textAlign: 'center', marginBottom: 6 }, modalInput: { borderWidth: 1, borderColor: '#d9dedb', borderRadius: 12, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 16 }, actionError: { color: colors.danger, textAlign: 'center', fontSize: 13 }, modalHint: { color: colors.muted, textAlign: 'center', lineHeight: 21 }, groupLink: { color: colors.primary, fontSize: 12, textAlign: 'center', lineHeight: 19, paddingHorizontal: 6 }, infoText: { color: colors.muted, fontSize: 15, textAlign: 'center', lineHeight: 24 }, infoLabel: { color: colors.text, fontWeight: '800', textAlign: 'center', marginTop: 6 }, infoEmail: { color: colors.primary, fontWeight: '800', textAlign: 'center', fontSize: 15 }, shareCodeText: { color: colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 18, letterSpacing: 1.2 }, groupOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, activeGroup: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, groupOptionName: { color: colors.text, fontSize: 16, fontWeight: '800' }, groupOptionCode: { color: colors.muted, marginTop: 3, fontSize: 12 }, primaryModalButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 }, primaryModalText: { color: '#fff', fontWeight: '800', fontSize: 16 }, secondaryModalButton: { borderColor: '#d6ded9', borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, secondaryModalText: { color: colors.text, fontWeight: '800', fontSize: 16 }, closeText: { color: colors.muted, textAlign: 'center', fontWeight: '700', paddingTop: 6, paddingBottom: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 13 }, requestName: { color: colors.text, fontWeight: '700', fontSize: 16 }, requestButtons: { flexDirection: 'row', gap: 8 }, acceptButton: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, acceptText: { color: '#fff', fontWeight: '800' }, rejectButton: { borderColor: '#e3b9b9', borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9 }, rejectText: { color: colors.danger, fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#eef0ef', paddingVertical: 12 }, memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff3dd', alignItems: 'center', justifyContent: 'center' }, memberAvatarText: { color: '#b57814', fontSize: 17, fontWeight: '800' }, memberName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }, managerBadge: { color: '#a66b17', backgroundColor: '#fff3dd', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10, fontSize: 12, fontWeight: '800' }, removeMemberButton: { borderWidth: 1, borderColor: '#efc4c4', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9 }, removeMemberText: { color: colors.danger, fontSize: 12, fontWeight: '800' }, managerChoice: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d7e5db', borderRadius: 10, padding: 12, gap: 8 }, chooseText: { color: colors.primary, fontWeight: '800', fontSize: 13 }, deleteGroupButton: { backgroundColor: '#fff0f0', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 }, deleteGroupText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  itemTapWide: { flex: 1.45 }, addedByNarrow: { flex: 0.9 },
});
