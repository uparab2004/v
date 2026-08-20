/*
  # Family shopping list schema

  ## Overview
  Adds everything needed for a shared, real-time family shopping list where
  people join a household using a 6-character code and must be approved by
  the household admin before they can see or edit the list.

  ## New Tables
  1. `households`
     - `id` (uuid, primary key)
     - `code` (text, unique) - the 6-character code families share to join
     - `created_at` (timestamptz)
  2. `household_members`
     - `id` (uuid, primary key)
     - `household_id` (uuid) - the household this membership belongs to
     - `user_id` (uuid) - the device/person's anonymous auth identity
     - `name` (text) - display name entered by the person
     - `status` (text) - 'pending' | 'approved' | 'rejected'
     - `is_admin` (boolean) - true for the household creator
     - `created_at` (timestamptz)
     - unique on (household_id, user_id) so a device only has one membership per household
  3. `shopping_items`
     - `id` (uuid, primary key)
     - `household_id` (uuid) - which household's list this item belongs to
     - `name` (text) - the free-text item, e.g. "حليب 2 لتر"
     - `is_purchased` (boolean) - moved to the purchased section when true
     - `created_by` / `purchased_by` (uuid) - who added / bought the item
     - `created_at`, `purchased_at` (timestamptz)

  ## Security
  - Row Level Security is enabled on all three tables.
  - Every person is identified by a stable anonymous Supabase auth session
    (no password/login screen shown to the user), so `auth.uid()` gives a
    real, unforgeable identity per device.
  - Nobody can read a household, its member list, or its items unless they
    already have a membership row for it. Only *approved* members can read
    or add shopping items.
  - There are NO direct insert/update policies on `households` or
    `household_members` - creating a household, requesting to join, and
    approving/rejecting a request all go through `SECURITY DEFINER`
    functions below that check the caller's real identity, so a member can
    never grant themselves admin rights or approve their own request by
    calling the API directly.
  - `shopping_items` can be inserted/updated directly by approved members
    (that is normal shared-list usage, not a privileged action), and the
    policies still verify household membership and prevent claiming another
    person's purchase.

  ## Functions
  - `create_household(p_name)` - creates a new household with a fresh unique
    code and makes the caller its approved admin.
  - `request_join_household(p_code, p_name)` - looks up a household by code
    and creates a pending membership request for the caller.
  - `respond_to_join_request(p_member_id, p_approve)` - lets an approved
    admin approve or reject a pending request in their own household.

  ## Realtime
  - `household_members` and `shopping_items` are added to the `supabase_realtime`
    publication so approvals, new items, and purchases sync instantly across
    every connected family device.
*/

CREATE TABLE IF NOT EXISTS households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS household_members_household_id_idx ON household_members(household_id);
CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON household_members(user_id);

CREATE TABLE IF NOT EXISTS shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_purchased boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  purchased_at timestamptz
);

CREATE INDEX IF NOT EXISTS shopping_items_household_id_idx ON shopping_items(household_id);

ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_items ENABLE ROW LEVEL SECURITY;

-- households: readable only by people with a membership row (pending or approved)
DROP POLICY IF EXISTS "select_own_household" ON households;
CREATE POLICY "select_own_household" ON households FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = households.id AND m.user_id = auth.uid()
    )
  );

-- household_members: see your own row, or every row in a household you are approved in
DROP POLICY IF EXISTS "select_own_or_household_members" ON household_members;
CREATE POLICY "select_own_or_household_members" ON household_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM household_members m2
      WHERE m2.household_id = household_members.household_id
        AND m2.user_id = auth.uid()
        AND m2.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "delete_own_membership" ON household_members;
CREATE POLICY "delete_own_membership" ON household_members FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- shopping_items: only approved members of the same household
DROP POLICY IF EXISTS "select_household_items" ON shopping_items;
CREATE POLICY "select_household_items" ON shopping_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = shopping_items.household_id
        AND m.user_id = auth.uid() AND m.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "insert_household_items" ON shopping_items;
CREATE POLICY "insert_household_items" ON shopping_items FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = shopping_items.household_id
        AND m.user_id = auth.uid() AND m.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "update_household_items" ON shopping_items;
CREATE POLICY "update_household_items" ON shopping_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = shopping_items.household_id
        AND m.user_id = auth.uid() AND m.status = 'approved'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = shopping_items.household_id
        AND m.user_id = auth.uid() AND m.status = 'approved'
    )
    AND (purchased_by IS NULL OR purchased_by = auth.uid())
  );

-- helper: generate a random, human-friendly 6 character code
CREATE OR REPLACE FUNCTION generate_household_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION generate_household_code() FROM PUBLIC;

CREATE OR REPLACE FUNCTION create_household(p_name text)
RETURNS TABLE(household_id uuid, code text, member_id uuid, is_admin boolean, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_household_id uuid;
  v_member_id uuid;
  v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'الاسم مطلوب';
  END IF;

  LOOP
    v_code := generate_household_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM households h WHERE h.code = v_code);
  END LOOP;

  INSERT INTO households (code) VALUES (v_code) RETURNING id INTO v_household_id;

  INSERT INTO household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'approved', true)
  RETURNING id INTO v_member_id;

  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_household(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_household(text) TO authenticated;

CREATE OR REPLACE FUNCTION request_join_household(p_code text, p_name text)
RETURNS TABLE(household_id uuid, member_id uuid, status text, is_admin boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
  v_member_id uuid;
  v_status text;
  v_is_admin boolean;
  v_name text := trim(p_name);
  v_code text := upper(trim(p_code));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'الاسم مطلوب';
  END IF;

  SELECT h.id INTO v_household_id FROM households h WHERE h.code = v_code;
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'رمز العائلة غير صحيح';
  END IF;

  INSERT INTO household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'pending', false)
  ON CONFLICT (household_id, user_id) DO UPDATE
    SET name = excluded.name,
        status = CASE WHEN household_members.status = 'rejected' THEN 'pending' ELSE household_members.status END
  RETURNING id, household_members.status, household_members.is_admin INTO v_member_id, v_status, v_is_admin;

  RETURN QUERY SELECT v_household_id, v_member_id, v_status, v_is_admin;
END;
$$;

REVOKE EXECUTE ON FUNCTION request_join_household(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_join_household(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION respond_to_join_request(p_member_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT household_id INTO v_household_id FROM household_members WHERE id = p_member_id;
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = v_household_id AND user_id = auth.uid()
      AND is_admin = true AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'غير مصرح لك بهذا الإجراء';
  END IF;

  UPDATE household_members
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  WHERE id = p_member_id AND household_id = v_household_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'household_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE household_members;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'shopping_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE shopping_items;
  END IF;
END $$;
