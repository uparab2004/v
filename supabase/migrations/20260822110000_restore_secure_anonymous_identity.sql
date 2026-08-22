/* Restore server-verified, invisible device identities with Supabase Auth. */

CREATE OR REPLACE FUNCTION create_household(p_name text)
RETURNS TABLE(household_id uuid, code text, member_id uuid, is_admin boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_code text; v_household_id uuid; v_member_id uuid; v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  LOOP
    v_code := generate_household_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM households WHERE code = v_code);
  END LOOP;
  INSERT INTO households (code) VALUES (v_code) RETURNING id INTO v_household_id;
  INSERT INTO household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'approved', true) RETURNING id INTO v_member_id;
  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

CREATE OR REPLACE FUNCTION request_join_household(p_code text, p_name text)
RETURNS TABLE(household_id uuid, member_id uuid, status text, is_admin boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_household_id uuid; v_member_id uuid; v_status text; v_is_admin boolean; v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  SELECT id INTO v_household_id FROM households WHERE code = upper(trim(p_code));
  IF v_household_id IS NULL THEN RAISE EXCEPTION 'رمز العائلة غير صحيح'; END IF;
  INSERT INTO household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'pending', false)
  ON CONFLICT (household_id, user_id) DO UPDATE
    SET name = excluded.name,
        status = CASE WHEN household_members.status = 'rejected' THEN 'pending' ELSE household_members.status END
  RETURNING id, household_members.status, household_members.is_admin INTO v_member_id, v_status, v_is_admin;
  RETURN QUERY SELECT v_household_id, v_member_id, v_status, v_is_admin;
END;
$$;

CREATE OR REPLACE FUNCTION respond_to_join_request(p_member_id uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_household_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  SELECT household_id INTO v_household_id FROM household_members WHERE id = p_member_id;
  IF v_household_id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;
  IF NOT EXISTS (SELECT 1 FROM household_members WHERE household_id = v_household_id AND user_id = auth.uid() AND is_admin AND status = 'approved') THEN
    RAISE EXCEPTION 'غير مصرح لك بهذا الإجراء';
  END IF;
  UPDATE household_members SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  WHERE id = p_member_id AND household_id = v_household_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_household(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION request_join_household(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_household(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_join_household(text, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_household(text), request_join_household(text, text), respond_to_join_request(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS "select_own_household" ON households;
DROP POLICY IF EXISTS "households_insert_all" ON households;
CREATE POLICY "select_own_household" ON households FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = households.id AND m.user_id = auth.uid()));

DROP POLICY IF EXISTS "select_own_or_household_members" ON household_members;
DROP POLICY IF EXISTS "household_members_insert_all" ON household_members;
DROP POLICY IF EXISTS "household_members_update_all" ON household_members;
DROP POLICY IF EXISTS "delete_own_membership" ON household_members;
CREATE POLICY "select_own_or_household_members" ON household_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = household_members.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));
CREATE POLICY "delete_own_membership" ON household_members FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "select_household_items" ON shopping_items;
DROP POLICY IF EXISTS "insert_household_items" ON shopping_items;
DROP POLICY IF EXISTS "update_household_items" ON shopping_items;
DROP POLICY IF EXISTS "delete_household_items" ON shopping_items;
CREATE POLICY "select_household_items" ON shopping_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));
CREATE POLICY "insert_household_items" ON shopping_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));
CREATE POLICY "update_household_items" ON shopping_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'))
  WITH CHECK (EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved') AND (purchased_by IS NULL OR purchased_by = auth.uid()));
CREATE POLICY "delete_household_items" ON shopping_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));
