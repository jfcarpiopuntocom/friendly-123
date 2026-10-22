-- E1b-1 candidate ONLY: a room-authorized metadata probe, without ciphertext.
-- Do NOT apply to production until the owner approves the E1/E2 release gate.
BEGIN;
CREATE OR REPLACE FUNCTION public.f123_relay_command(
 p_room text,p_action text,p_message jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE h text; active_rev bigint; latest_seq bigint;
BEGIN
 IF p_room IS NULL OR p_room !~ '^[A-Za-z0-9_-]{1,128}$' THEN
  RAISE insufficient_privilege USING MESSAGE='Room capability not authorized';
 END IF;
 h:=encode(extensions.digest('friendly-relay:'||p_room,'sha256'),'hex');
 -- Exactly the existing active-room lock. This serializes the metadata cut
 -- with checkpoint revision changes and all durable operation writes.
 SELECT revision INTO active_rev FROM relay_private.rooms
 WHERE room_hash=h AND transport_active FOR UPDATE;
 IF NOT FOUND THEN
  RAISE insufficient_privilege USING MESSAGE='Room capability not authorized';
 END IF;
 CASE p_action
 WHEN 'head' THEN
  SELECT coalesce(max(seq),0) INTO latest_seq
  FROM relay_private.operations WHERE room_hash=h;
  RETURN jsonb_build_object('v',2,'rev',active_rev,'seq',latest_seq);
 WHEN 'op' THEN RETURN relay_private.persist_operation(h,p_message->>'id',(p_message->>'lam')::bigint,p_message->>'c');
 WHEN 'ckpt' THEN RETURN relay_private.save_checkpoint(h,(p_message->>'lam')::bigint,p_message->>'c',coalesce((p_message->>'v')::integer,1),(p_message->>'rev')::bigint,(p_message->>'seq')::bigint);
 WHEN 'pull' THEN
  IF (p_message->>'v')::integer=2 THEN RETURN relay_private.pull_page(h,(p_message->>'rev')::bigint,(p_message->>'seq')::bigint,(p_message->>'limit')::integer); END IF;
  RETURN jsonb_build_object('frames',relay_private.pull_legacy(h,(p_message->>'lam')::bigint));
 WHEN 'ts' THEN RETURN jsonb_build_object('k','tsr','t0',p_message->'t0','t1',floor(extract(epoch from clock_timestamp())*1000)::bigint);
 ELSE RAISE invalid_parameter_value USING MESSAGE='Unsupported relay command';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION public.f123_relay_command(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f123_relay_command(text,text,jsonb) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.f123_relay_command(text,text,jsonb) IS
 'Active-room locked capability including read-only E1b rev+seq head; no ciphertext in head reply.';
COMMIT;
