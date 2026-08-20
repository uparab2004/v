/*
  # Fix permissions for anonymous users

  ## Problem
  The app uses Supabase anonymous sign-in (`signInAnonymously()`) to give each
  device a stable identity. Anonymous users receive the `anon` role, NOT
  `authenticated`. The previous migration revoked EXECUTE from `anon` on the
  SECURITY DEFINER functions, so every call from the app failed with
  "permission denied for function create_household".

  ## Fix
  1. Grant EXECUTE on `create_household`, `request_join_household`, and
     `respond_to_join_request` back to the `anon` role. Each function already
     has an internal `auth.uid() IS NULL` check that rejects calls without a
     valid (anonymous) session, so this is safe.
  2. Update ALL RLS policies on `households`, `household_members`, and
     `shopping_items` to include `TO anon, authenticated` instead of only
     `TO authenticated`. Anonymous users have a real `auth.uid()`, so the
     ownership predicates work correctly.
*/

-- Grant EXECUTE to anon for all three functions
GRANT EXECUTE ON FUNCTION create_household(text) TO anon;
GRANT EXECUTE ON FUNCTION request_join_household(text, text) TO anon;
GRANT EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean) TO anon;

-- households: readable by anyone with a membership (anon or authenticated)
DROP POLICY IF EXISTS "select_own_household" ON households;
CREATE POLICY "select_own_household" ON households FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = households.id AND m.user_id = auth.uid()
    )
  );

-- household_members: see your own row, or every row in a household you are approved in
DROP POLICY IF EXISTS "select_own_or_household_members" ON household_members;
CREATE POLICY "select_own_or_household_members" ON household_members FOR SELECT
  TO anon, authenticated
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
  TO anon, authenticated
  USING (user_id = auth.uid());

-- shopping_items: only approved members of the same household
DROP POLICY IF EXISTS "select_household_items" ON shopping_items;
CREATE POLICY "select_household_items" ON shopping_items FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM household_members m
      WHERE m.household_id = shopping_items.household_id
        AND m.user_id = auth.uid() AND m.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "insert_household_items" ON shopping_items;
CREATE POLICY "insert_household_items" ON shopping_items FOR INSERT
  TO anon, authenticated
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
  TO anon, authenticated
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
