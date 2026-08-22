/* Repair the initial Maqadhi schema without deleting application data. */

CREATE OR REPLACE FUNCTION maqadhi.is_household_member(p_household_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = maqadhi, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM maqadhi.household_members
    WHERE household_id = p_household_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION maqadhi.is_approved_member(p_household_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = maqadhi, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM maqadhi.household_members
    WHERE household_id = p_household_id AND user_id = auth.uid() AND status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION maqadhi.is_household_member(uuid), maqadhi.is_approved_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maqadhi.is_household_member(uuid), maqadhi.is_approved_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "read own household" ON maqadhi.households;
CREATE POLICY "read own household" ON maqadhi.households FOR SELECT TO authenticated
  USING (maqadhi.is_household_member(id));

DROP POLICY IF EXISTS "read household members" ON maqadhi.household_members;
CREATE POLICY "read household members" ON maqadhi.household_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR maqadhi.is_approved_member(household_id));

DROP POLICY IF EXISTS "read members in own household" ON maqadhi.household_members;

DROP POLICY IF EXISTS "read household items" ON maqadhi.shopping_items;
CREATE POLICY "read household items" ON maqadhi.shopping_items FOR SELECT TO authenticated
  USING (maqadhi.is_approved_member(household_id));

DROP POLICY IF EXISTS "add household items" ON maqadhi.shopping_items;
CREATE POLICY "add household items" ON maqadhi.shopping_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND maqadhi.is_approved_member(household_id));

DROP POLICY IF EXISTS "update household items" ON maqadhi.shopping_items;
CREATE POLICY "update household items" ON maqadhi.shopping_items FOR UPDATE TO authenticated
  USING (maqadhi.is_approved_member(household_id))
  WITH CHECK (maqadhi.is_approved_member(household_id) AND (purchased_by IS NULL OR purchased_by = auth.uid()));

DROP POLICY IF EXISTS "delete household items" ON maqadhi.shopping_items;
CREATE POLICY "delete household items" ON maqadhi.shopping_items FOR DELETE TO authenticated
  USING (maqadhi.is_approved_member(household_id));

CREATE OR REPLACE FUNCTION maqadhi.create_household(p_name text)
RETURNS TABLE(household_id uuid, code text, member_id uuid, is_admin boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = maqadhi, public
AS $$
DECLARE v_code text; v_household_id uuid; v_member_id uuid; v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  LOOP
    v_code := maqadhi.generate_household_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM maqadhi.households h WHERE h.code = v_code);
  END LOOP;
  INSERT INTO maqadhi.households (code) VALUES (v_code) RETURNING id INTO v_household_id;
  INSERT INTO maqadhi.household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'approved', true) RETURNING id INTO v_member_id;
  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

NOTIFY pgrst, 'reload schema';
