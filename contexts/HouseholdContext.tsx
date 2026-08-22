import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '@/lib/supabase';
import { getOrCreateUserId } from '@/lib/identity';
import { HouseholdMember } from '@/lib/types';

type Phase = 'loading' | 'onboarding' | 'pending' | 'rejected' | 'approved';

interface HouseholdContextValue {
  phase: Phase;
  household: { id: string; code: string } | null;
  member: HouseholdMember | null;
  members: HouseholdMember[];
  errorMessage: string | null;
  clearError: () => void;
  retryIdentity: () => void;
  createHousehold: (name: string) => Promise<void>;
  joinHousehold: (code: string, name: string) => Promise<void>;
  respondToRequest: (memberId: string, approve: boolean) => Promise<void>;
  leaveHousehold: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

const GENERIC_ERROR = 'حدث خطأ، حاول مرة أخرى';

function friendlyMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    const technicalError = /policy|schema cache|column reference|recursion|function|postgres|pgrst/i;
    if (message && !technicalError.test(message) && message.length < 120) {
      return message;
    }
  }
  return GENERIC_ERROR;
}

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [household, setHousehold] = useState<{ id: string; code: string } | null>(null);
  const [member, setMember] = useState<HouseholdMember | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const userIdRef = useRef<string | null>(null);

  const clearError = useCallback(() => setErrorMessage(null), []);
  const retryIdentity = useCallback(() => {
    setErrorMessage(null);
    setPhase('loading');
    setIdentityAttempt((attempt) => attempt + 1);
  }, []);

  const loadMembers = useCallback(async (householdId: string) => {
    const { data, error } = await supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });

    if (error) {
      setErrorMessage(friendlyMessage(error));
      return;
    }
    setMembers((data ?? []) as HouseholdMember[]);
  }, []);

  const applyMembership = useCallback(
    async (row: HouseholdMember | null) => {
      if (!row) {
        setPhase('onboarding');
        setHousehold(null);
        setMember(null);
        setMembers([]);
        return;
      }

      setMember(row);

      const { data: householdRow, error: householdError } = await supabase
        .from('households')
        .select('id, code')
        .eq('id', row.household_id)
        .maybeSingle();

      if (householdError || !householdRow) {
        console.error('load household failed', householdError);
        setPhase('onboarding');
        setHousehold(null);
        setMember(null);
        return;
      }

      setHousehold(householdRow);

      if (row.status === 'approved') {
        setPhase('approved');
        await loadMembers(row.household_id);
      } else if (row.status === 'pending') {
        setPhase('pending');
      } else {
        setPhase('rejected');
      }
    },
    [loadMembers],
  );

  const loadOwnMembership = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from('household_members')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setErrorMessage(friendlyMessage(error));
        setPhase('onboarding');
        return;
      }
      await applyMembership((data as HouseholdMember | null) ?? null);
    },
    [applyMembership],
  );

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const userId = await getOrCreateUserId();
        if (!isMounted) return;
        userIdRef.current = userId;
        await loadOwnMembership(userId);
      } catch {
        if (isMounted) {
          setErrorMessage('تعذر تهيئة هوية الجهاز، حاول مرة أخرى');
          setPhase('onboarding');
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [identityAttempt, loadOwnMembership]);

  useEffect(() => {
    if (!household) return;

    const channel = supabase
      .channel(`household-members-${household.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'maqadhi',
          table: 'household_members',
          filter: `household_id=eq.${household.id}`,
        },
        () => {
          const userId = userIdRef.current;
          if (userId) {
            loadOwnMembership(userId);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [household?.id, loadOwnMembership]);

  const createHousehold = useCallback(
    async (name: string) => {
      setErrorMessage(null);
      const userId = userIdRef.current;
      if (!userId) return;
      const { data, error } = await supabase.rpc('create_household', {
        p_name: name,
      });
      if (error || !data || data.length === 0) {
        setErrorMessage(friendlyMessage(error));
        return;
      }
      const result = data[0];
      await applyMembership({
        id: result.member_id,
        household_id: result.household_id,
        user_id: userId,
        name,
        status: 'approved',
        is_admin: true,
        created_at: new Date().toISOString(),
      });
    },
    [applyMembership],
  );

  const joinHousehold = useCallback(
    async (code: string, name: string) => {
      setErrorMessage(null);
      const userId = userIdRef.current;
      if (!userId) return;
      const { data, error } = await supabase.rpc('request_join_household', {
        p_code: code,
        p_name: name,
      });
      if (error || !data || data.length === 0) {
        setErrorMessage(friendlyMessage(error));
        return;
      }
      const result = data[0];
      await applyMembership({
        id: result.member_id,
        household_id: result.household_id,
        user_id: userId,
        name,
        status: result.status,
        is_admin: result.is_admin,
        created_at: new Date().toISOString(),
      });
    },
    [applyMembership],
  );

  const respondToRequest = useCallback(
    async (memberId: string, approve: boolean) => {
      setErrorMessage(null);
      const userId = userIdRef.current;
      if (!userId) return;
      const { error } = await supabase.rpc('respond_to_join_request', {
        p_member_id: memberId,
        p_approve: approve,
      });
      if (error) {
        setErrorMessage(friendlyMessage(error));
        return;
      }
      if (household) {
        await loadMembers(household.id);
      }
    },
    [household, loadMembers],
  );

  const leaveHousehold = useCallback(async () => {
    setErrorMessage(null);
    if (!member) return;
    const { error } = await supabase.from('household_members').delete().eq('id', member.id);
    if (error) {
      setErrorMessage(GENERIC_ERROR);
      return;
    }
    setPhase('onboarding');
    setHousehold(null);
    setMember(null);
    setMembers([]);
  }, [member]);

  return (
    <HouseholdContext.Provider
      value={{
        phase,
        household,
        member,
        members,
        errorMessage,
        clearError,
        retryIdentity,
        createHousehold,
        joinHousehold,
        respondToRequest,
        leaveHousehold,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return ctx;
}
