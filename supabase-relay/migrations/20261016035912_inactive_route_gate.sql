BEGIN;
ALTER TABLE relay_private.rooms ADD COLUMN transport_active boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.f123_relay_route(p_room text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
 SELECT jsonb_build_object('mode',CASE WHEN p_room ~ '^[a-f0-9]{40}$' AND (
  SELECT count(*)=4 AND bool_and(transport_active)
  FROM relay_private.rooms WHERE room_hash IN (
   SELECT encode(extensions.digest('friendly-relay:'||p_room||suffix,'sha256'),'hex')
   FROM (VALUES(''),('-y'),('-ops'),('-fotos')) AS channels(suffix)
  )
 ) THEN 'supabase' ELSE 'legacy' END);
$$;
REVOKE ALL ON FUNCTION public.f123_relay_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f123_relay_route(text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.f123_relay_route(text) IS 'Known capability only; no enumeration. Entire channel group stays on legacy until operator activation. Does not register, activate or expose data.';
COMMIT;
