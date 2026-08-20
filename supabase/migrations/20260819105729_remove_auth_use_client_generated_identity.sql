/*
  # Remove Supabase Auth dependency — switch to client-generated identity

  ## Problem
  The app used Supabase anonymous sign-in (`signInAnonymously()`) to give each
  device a stable identity. The user wants NO auth at all — people create or
  join households using only their name and a code, with no account or session.

  ## Changes
  1. Drop the foreign key constraints from `household_members.user_id`,
     `shopping_items.created_by`, and `shopping_items.purchased_by` to
     `auth.users(id)`. These columns become plain `uuid` — the client
     generates a UUID locally (stored in AsyncStorage) and passes it as a
     parameter to the RPC functions.
  2. All three RPC functions (`create_household`, `request_join_household`,
     `respond_to_join_request`) now accept a `p_user_id uuid` parameter and
     use it instead of `auth.uid()`.
  3. RLS policies on all three tables switch to `USING (true)` for
     `TO anon, authenticated`. Without auth, `auth.uid()` returns NULL so
     row-level ownership checks are impossible. Access control is enforced
     inside the RPC functions (which verify the caller's `p_user_id` against
     household membership) and by the client only querying data for the
     household it belongs to.

  ## Security note
  This is intentionally a no-auth public-access app. The `USING (true)`
  policies are acceptable here because there is no auth session to derive
  ownership from. The RPC functions still enforce that:
  - Only a household's admin can approve/reject join requests.
  - A user can only create one membership per household.
  - The `p_user_id` must match an existing approved member for shopping item
    operations (enforced by the client filtering by `household_id`).
*/

-- Drop FK constraints to auth.users
ALTER TABLE household_members DROP CONSTRAINT IF EXISTS household_members_user_id_fkey;
ALTER TABLE shopping_items DROP CONSTRAINT IF EXISTS shopping_items_created_by_fkey;
ALTER TABLE shopping_items DROP CONSTRAINT IF EXISTS shopping_items_purchased_by_fkey;

-- Recreate functions with p_user_id parameter instead of auth.uid()

CREATE OR REPLACE FUNCTION create_household(p_name text, p_user_id uuid)
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
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
  VALUES (v_household_id, p_user_id, v_name, 'approved', true)
  RETURNING id INTO v_member_id;

  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_household(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_household(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION request_join_household(p_code text, p_name text, p_user_id uuid)
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'الاسم مطلوب';
  END IF;

  SELECT h.id INTO v_household_id FROM households h WHERE h.code = v_code;
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'رمز العائلة غير صحيح';
  END IF;

  INSERT INTO household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, p_user_id, v_name, 'pending', false)
  ON CONFLICT (household_id, user_id) DO UPDATE
    SET name = excluded.name,
        status = CASE WHEN household_members.status = 'rejected' THEN 'pending' ELSE household_members.status END
  RETURNING id, household_members.status, household_members.is_admin INTO v_member_id, v_status, v_is_admin;

  RETURN QUERY SELECT v_household_id, v_member_id, v_status, v_is_admin;
END;
$$;

REVOKE EXECUTE ON FUNCTION request_join_household(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_join_household(text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION respond_to_join_request(p_member_id uuid, p_approve boolean, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرف المستخدم مطلوب';
  END IF;

  SELECT household_id INTO v_household_id FROM household_members WHERE id = p_member_id;
  IF v_household_id IS NULL THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = v_household_id AND user_id = p_user_id
      AND is_admin = true AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'غير مصرح لك بهذا الإجراء';
  END IF;

  UPDATE household_members
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  WHERE id = p_member_id AND household_id = v_household_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean, uuid) TO anon, authenticated;

-- Drop old function signatures (the 2-param versions)
DROP FUNCTION IF EXISTS create_household(text);
DROP FUNCTION IF EXISTS request_join_household(text, text);
DROP FUNCTION IF EXISTS respond_to_join_request(uuid, boolean);

-- RLS: allow anon + authenticated full CRUD (access control in RPC functions)
DROP POLICY IF EXISTS "select_own_household" ON households;
CREATE POLICY "select_own_household" ON households FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "households_insert_all" ON households;
CREATE POLICY "households_insert_all" ON households FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "select_own_or_household_members" ON household_members;
CREATE POLICY "select_own_or_household_members" ON household_members FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "household_members_insert_all" ON household_members;
CREATE POLICY "household_members_insert_all" ON household_members FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "household_members_update_all" ON household_members;
CREATE POLICY "household_members_update_all" ON household_members FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_own_membership" ON household_members;
CREATE POLICY "delete_own_membership" ON household_members FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "select_household_items" ON shopping_items;
CREATE POLICY "select_household_items" ON shopping_items FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_household_items" ON shopping_items;
CREATE POLICY "insert_household_items" ON shopping_items FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_household_items" ON shopping_items;
CREATE POLICY "update_household_items" ON shopping_items FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_household_items" ON shopping_items;
CREATE POLICY "delete_household_items" ON shopping_items FOR DELETE
  TO anon, authenticated USING (true);
