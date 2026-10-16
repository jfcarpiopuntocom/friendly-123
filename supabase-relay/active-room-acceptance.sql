-- Synthetic room only. Run after the active-room gate migration; rollback
-- removes the room, imported history, activation and operations together.
BEGIN;
SELECT set_config('friendly_test.gate_room','synthetic-gate-'||replace(gen_random_uuid()::text,'-',''),true);
DO $test$
DECLARE room text:=current_setting('friendly_test.gate_room'); h text;
 source text:='{"v":1,"cut":{"minSeq":0,"maxSeq":0},"checkpoint":null,"ops":[]}'; result jsonb;
BEGIN
 h:=encode(extensions.digest('friendly-relay:'||room,'sha256'),'hex');
 result:=public.f123_relay_import(h,source,encode(extensions.digest(source,'sha256'),'hex'));
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Private cold import into staging failed'; END IF;
 IF (SELECT transport_active FROM relay_private.rooms WHERE room_hash=h) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Import activated staging'; END IF;
 IF public.f123_relay_has_topic('friendly:'||room) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Inactive staging permits channel access'; END IF;
 IF has_function_privilege('anon','public.f123_relay_import(text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.f123_relay_import(text,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.f123_relay_import(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Private importer grants changed'; END IF;
END $test$;

SET LOCAL ROLE anon;
DO $test$
DECLARE room text:=current_setting('friendly_test.gate_room'); action text;
BEGIN
 IF public.f123_relay_has_topic('friendly:'||room) IS DISTINCT FROM false
 OR public.f123_relay_has_topic('friendly:synthetic-unregistered') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Inactive/unregistered topic exposed'; END IF;
 FOREACH action IN ARRAY ARRAY['op','ckpt','pull','ts'] LOOP
  BEGIN
   PERFORM public.f123_relay_command(room,action,'{"id":"synthetic-denied","lam":1,"c":"AQID","v":2,"rev":1,"seq":0}'::jsonb);
   RAISE EXCEPTION 'Inactive staging command accepted: %',action;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $test$;
RESET ROLE;

DO $test$
DECLARE room text:=current_setting('friendly_test.gate_room'); h text;
BEGIN
 h:=encode(extensions.digest('friendly-relay:'||room,'sha256'),'hex');
 IF EXISTS(SELECT 1 FROM relay_private.operations WHERE room_hash=h)
 OR (SELECT revision FROM relay_private.rooms WHERE room_hash=h)<>1 THEN RAISE EXCEPTION 'Denied commands changed staging'; END IF;
 UPDATE relay_private.rooms SET transport_active=true WHERE room_hash=h;
END $test$;

SET LOCAL ROLE anon;
DO $test$
DECLARE room text:=current_setting('friendly_test.gate_room'); result jsonb;
BEGIN
 IF public.f123_relay_has_topic('friendly:'||room) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Active topic denied'; END IF;
 result:=public.f123_relay_command(room,'op','{"id":"synthetic-active","lam":1,"c":"AQID"}'::jsonb);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Active durable operation failed'; END IF;
 result:=public.f123_relay_command(room,'op','{"id":"synthetic-active","lam":1,"c":"BAUG"}'::jsonb);
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Re-encrypted stable-ID retry changed'; END IF;
 result:=public.f123_relay_command(room,'pull','{"v":2,"rev":1,"seq":0,"limit":64}'::jsonb);
 IF result->'frames' IS DISTINCT FROM '["AQID"]'::jsonb THEN RAISE EXCEPTION 'Active replay changed ciphertext'; END IF;
 result:=public.f123_relay_command(room,'ckpt',jsonb_build_object('id','synthetic-checkpoint','lam',1,'c','AQID','v',2,'rev',1,'seq',(result->>'seq')::bigint));
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Active checkpoint failed'; END IF;
 result:=public.f123_relay_command(room,'ts','{"t0":123}'::jsonb);
 IF result->>'k' IS DISTINCT FROM 'tsr' THEN RAISE EXCEPTION 'Active time response changed'; END IF;
END $test$;
RESET ROLE;

DO $test$
BEGIN
 UPDATE relay_private.rooms SET transport_active=false
 WHERE room_hash=encode(extensions.digest('friendly-relay:'||current_setting('friendly_test.gate_room'),'sha256'),'hex');
END $test$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE room text:=current_setting('friendly_test.gate_room'); action text;
BEGIN
 IF public.f123_relay_has_topic('friendly:'||room) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Deactivated topic exposed'; END IF;
 FOREACH action IN ARRAY ARRAY['op','ckpt','pull','ts'] LOOP
  BEGIN
   PERFORM public.f123_relay_command(room,action,'{"id":"synthetic-denied-again","lam":1,"c":"AQID","v":2,"rev":2,"seq":0}'::jsonb);
   RAISE EXCEPTION 'Deactivated command accepted: %',action;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $test$;
RESET ROLE;
SELECT 'inactive staging denied; active durable retry/replay/checkpoint preserved; importer private' AS evidence;
ROLLBACK;
