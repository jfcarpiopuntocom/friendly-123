BEGIN;
DO $test$
DECLARE h text:=repeat('d',64); r jsonb; page jsonb;
BEGIN
 PERFORM relay_private.open_room(h);
 PERFORM relay_private.persist_operation(h,'synthetic-reencrypted-sale',20,'AQIDBA==');
 r:=relay_private.persist_operation(h,'synthetic-reencrypted-sale',20,'BQYHCA==');
 IF r->>'ok'<>'true' OR r->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Valid stable-ID retry with a fresh encryption IV was not acknowledged'; END IF;
 page:=relay_private.pull_page(h,-1,0,64);
 IF page->'frames'<>'["AQIDBA=="]'::jsonb OR page->>'n'<>'1' THEN RAISE EXCEPTION 'Retry changed or duplicated the first durable envelope'; END IF;
END $test$;
ROLLBACK;
