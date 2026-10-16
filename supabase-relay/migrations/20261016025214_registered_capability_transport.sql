-- Compatibility boundary: possession of the existing opaque room capability.
-- Registration is backend-only; public callers cannot enumerate/create rooms.
BEGIN;
CREATE FUNCTION public.f123_relay_has_topic(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
 SELECT p_topic ~ '^friendly:[A-Za-z0-9_-]{1,128}$' AND EXISTS(
  SELECT 1 FROM relay_private.rooms
  WHERE room_hash=encode(extensions.digest('friendly-relay:'||substring(p_topic from 10),'sha256'),'hex')
 );
$$;
REVOKE ALL ON FUNCTION public.f123_relay_has_topic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f123_relay_has_topic(text) TO anon,authenticated,service_role;

CREATE FUNCTION public.f123_relay_command(p_room text,p_action text,p_message jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE h text;
BEGIN
 IF NOT public.f123_relay_has_topic('friendly:'||p_room) THEN
  RAISE insufficient_privilege USING MESSAGE='Room capability not authorized';
 END IF;
 h:=encode(extensions.digest('friendly-relay:'||p_room,'sha256'),'hex');
 CASE p_action
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

CREATE POLICY f123_registered_relay_receive ON realtime.messages FOR SELECT TO anon,authenticated
 USING(extension IN('broadcast','presence') AND (SELECT public.f123_relay_has_topic(realtime.topic())));
CREATE POLICY f123_registered_relay_send ON realtime.messages FOR INSERT TO anon,authenticated
 WITH CHECK(extension IN('broadcast','presence') AND (SELECT public.f123_relay_has_topic(realtime.topic())));
COMMIT;
