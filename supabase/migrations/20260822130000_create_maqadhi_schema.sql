/* A clean, isolated data schema for the Maqadhi application. */

DROP SCHEMA IF EXISTS maqadhi CASCADE;
DROP TABLE IF EXISTS public.items CASCADE;
DROP TABLE IF EXISTS public.members CASCADE;
DROP TABLE IF EXISTS public.household_members CASCADE;
DROP TABLE IF EXISTS public.shopping_items CASCADE;
DROP TABLE IF EXISTS public.households CASCADE;
DROP FUNCTION IF EXISTS public.create_household(text);
DROP FUNCTION IF EXISTS public.create_household(text, uuid);
DROP FUNCTION IF EXISTS public.request_join_household(text, text);
DROP FUNCTION IF EXISTS public.request_join_household(text, text, uuid);
DROP FUNCTION IF EXISTS public.respond_to_join_request(uuid, boolean);
DROP FUNCTION IF EXISTS public.respond_to_join_request(uuid, boolean, uuid);
DROP FUNCTION IF EXISTS public.generate_household_code();

CREATE SCHEMA maqadhi;
GRANT USAGE ON SCHEMA maqadhi TO anon, authenticated;

CREATE TABLE maqadhi.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL CHECK (code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maqadhi.household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES maqadhi.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE maqadhi.shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES maqadhi.households(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  is_purchased boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  purchased_at timestamptz
);

CREATE INDEX household_members_household_id_idx ON maqadhi.household_members(household_id);
CREATE INDEX household_members_user_id_idx ON maqadhi.household_members(user_id);
CREATE INDEX shopping_items_household_id_idx ON maqadhi.shopping_items(household_id);

ALTER TABLE maqadhi.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE maqadhi.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE maqadhi.shopping_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own household" ON maqadhi.households FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = households.id AND m.user_id = auth.uid()));

CREATE POLICY "read household members" ON maqadhi.household_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM maqadhi.household_members me
    WHERE me.household_id = household_members.household_id AND me.user_id = auth.uid() AND me.status = 'approved'
  ));

CREATE POLICY "leave own household" ON maqadhi.household_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "read household items" ON maqadhi.shopping_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));

CREATE POLICY "add household items" ON maqadhi.shopping_items FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'
  ));

CREATE POLICY "update household items" ON maqadhi.shopping_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'
  ) AND (purchased_by IS NULL OR purchased_by = auth.uid()));

CREATE POLICY "delete household items" ON maqadhi.shopping_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM maqadhi.household_members m WHERE m.household_id = shopping_items.household_id AND m.user_id = auth.uid() AND m.status = 'approved'));

CREATE FUNCTION maqadhi.generate_household_code()
RETURNS text LANGUAGE plpgsql SET search_path = maqadhi, public
AS $$
DECLARE chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text := ''; i integer;
BEGIN
  FOR i IN 1..6 LOOP result := result || substr(chars, floor(random() * length(chars))::integer + 1, 1); END LOOP;
  RETURN result;
END;
$$;

CREATE FUNCTION maqadhi.create_household(p_name text)
RETURNS TABLE(household_id uuid, code text, member_id uuid, is_admin boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = maqadhi, public
AS $$
DECLARE v_code text; v_household_id uuid; v_member_id uuid; v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  LOOP
    v_code := maqadhi.generate_household_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM maqadhi.households WHERE code = v_code);
  END LOOP;
  INSERT INTO maqadhi.households (code) VALUES (v_code) RETURNING id INTO v_household_id;
  INSERT INTO maqadhi.household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'approved', true) RETURNING id INTO v_member_id;
  RETURN QUERY SELECT v_household_id, v_code, v_member_id, true, 'approved'::text;
END;
$$;

CREATE FUNCTION maqadhi.request_join_household(p_code text, p_name text)
RETURNS TABLE(household_id uuid, member_id uuid, status text, is_admin boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = maqadhi, public
AS $$
DECLARE v_household_id uuid; v_member_id uuid; v_status text; v_is_admin boolean; v_name text := trim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  IF v_name IS NULL OR v_name = '' THEN RAISE EXCEPTION 'الاسم مطلوب'; END IF;
  SELECT id INTO v_household_id FROM maqadhi.households WHERE code = upper(trim(p_code));
  IF v_household_id IS NULL THEN RAISE EXCEPTION 'رمز العائلة غير صحيح'; END IF;
  INSERT INTO maqadhi.household_members (household_id, user_id, name, status, is_admin)
  VALUES (v_household_id, auth.uid(), v_name, 'pending', false)
  ON CONFLICT (household_id, user_id) DO UPDATE SET name = excluded.name,
    status = CASE WHEN maqadhi.household_members.status = 'rejected' THEN 'pending' ELSE maqadhi.household_members.status END
  RETURNING id, maqadhi.household_members.status, maqadhi.household_members.is_admin INTO v_member_id, v_status, v_is_admin;
  RETURN QUERY SELECT v_household_id, v_member_id, v_status, v_is_admin;
END;
$$;

CREATE FUNCTION maqadhi.respond_to_join_request(p_member_id uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = maqadhi, public
AS $$
DECLARE v_household_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تهيئة هوية الجهاز'; END IF;
  SELECT household_id INTO v_household_id FROM maqadhi.household_members WHERE id = p_member_id;
  IF v_household_id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;
  IF NOT EXISTS (SELECT 1 FROM maqadhi.household_members WHERE household_id = v_household_id AND user_id = auth.uid() AND is_admin AND status = 'approved') THEN
    RAISE EXCEPTION 'غير مصرح لك بهذا الإجراء';
  END IF;
  UPDATE maqadhi.household_members SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION maqadhi.generate_household_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION maqadhi.create_household(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION maqadhi.request_join_household(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION maqadhi.respond_to_join_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maqadhi.create_household(text), maqadhi.request_join_household(text, text), maqadhi.respond_to_join_request(uuid, boolean) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE maqadhi.household_members, maqadhi.shopping_items;
NOTIFY pgrst, 'reload schema';
