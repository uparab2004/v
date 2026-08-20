/*
  # Restrict household functions to signed-in sessions only

  The database linter flagged that `create_household`, `request_join_household`,
  and `respond_to_join_request` were still callable by the `anon` role because
  Supabase grants EXECUTE to `anon` and `authenticated` by default when a
  function is created. Each function already refuses to run without a real
  session (`auth.uid()` check), but we tighten this further by revoking
  EXECUTE from `anon` explicitly, so only signed-in (including anonymous
  auth) sessions can call them at all.
*/

REVOKE EXECUTE ON FUNCTION create_household(text) FROM anon;
REVOKE EXECUTE ON FUNCTION request_join_household(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION respond_to_join_request(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION generate_household_code() FROM anon, authenticated;
