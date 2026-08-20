export type MemberStatus = 'pending' | 'approved' | 'rejected';

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string;
  name: string;
  status: MemberStatus;
  is_admin: boolean;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  household_id: string;
  name: string;
  is_purchased: boolean;
  created_by: string | null;
  purchased_by: string | null;
  created_at: string;
  purchased_at: string | null;
}
