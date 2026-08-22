/* Human-friendly group name, shared by all members of a household. */
ALTER TABLE maqadhi.households
  ADD COLUMN IF NOT EXISTS name text;

UPDATE maqadhi.households
SET name = COALESCE(NULLIF(trim(owner_name), ''), 'عائلة ' || code)
WHERE name IS NULL OR trim(name) = '';

ALTER TABLE maqadhi.households
  ALTER COLUMN name SET NOT NULL;

CREATE OR REPLACE FUNCTION maqadhi.create_household(p_name text, p_household_name text)
RETURNS TABLE(household_id uuid, code text, member_id uuid, is_admin boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = maqadhi, public
AS $$
DECLARE
  v_code text;
  v_household_id uuid;
  v_member_id uuid;
  v_name text := trim(p_name);
  v_household_name text := trim(p_household_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  IF v_household_name IS NULL OR v_household_name = '' THEN RAISE EXCEPTION 'اسم المجموعة مطلوب'; END IF;
  LOOP
    v_code := maqadhi.generate_household_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM maqadhi.households h WHERE h.code = v_code);
  END LOOP;
  INSERT INTO maqadhi.households (code, owner_name, name)
  VALUES (v_code, v_name, v_household_name)
  RETURNING id INTO v_household_id;
  INSERT INTO maqadhi.household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'approved', true)
  RETURNING id INTO v_member_id;
  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

REVOKE ALL ON FUNCTION maqadhi.create_household(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maqadhi.create_household(text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
