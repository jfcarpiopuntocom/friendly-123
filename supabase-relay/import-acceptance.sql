BEGIN;
DO $test$
DECLARE h text:=repeat('e',64); source text; checksum text; result jsonb; page jsonb;
BEGIN
 source:='{"v":1,"cut":{"minSeq":8,"maxSeq":12},"checkpoint":{"lam":20,"c":"AQID","rev":7,"v":2},"ops":[{"seq":8,"id":"synthetic-import-a","lam":30,"c":"BAUG"},{"seq":12,"id":"synthetic-import-b","lam":10,"c":"BwgJ"}]}';
 checksum:=encode(extensions.digest(source,'sha256'),'hex');
 result:=public.f123_relay_import(h,source,checksum);
 IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'Cold encrypted import failed'; END IF;
 page:=relay_private.pull_page(h,7,999999,64);
 IF page->>'rev'<>'8' OR page->'frames'<>'["AQID","BAUG","BwgJ"]'::jsonb THEN RAISE EXCEPTION 'Imported checkpoint, order or generation changed'; END IF;
 result:=public.f123_relay_import(h,source,checksum);
 IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Same import was not idempotent'; END IF;
 result:=public.f123_relay_import(h,source,repeat('0',64));
 IF result->>'ok'<>'false' THEN RAISE EXCEPTION 'Corrupt copy accepted'; END IF;
 PERFORM relay_private.open_room(repeat('f',64));
 PERFORM relay_private.persist_operation(repeat('f',64),'synthetic-existing',1,'AQID');
 result:=public.f123_relay_import(repeat('f',64),source,checksum);
 IF result->>'ok'<>'false' OR (SELECT count(*) FROM relay_private.operations WHERE room_hash=repeat('f',64))<>1 THEN RAISE EXCEPTION 'Live target was overwritten'; END IF;
 IF has_function_privilege('anon','public.f123_relay_import(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Public import access'; END IF;
END $test$;
ROLLBACK;
