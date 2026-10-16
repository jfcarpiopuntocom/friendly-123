-- Synthetic only. Rollback leaves no room, operation or customer data behind.
BEGIN;
DO $test$
DECLARE h text := repeat('a',64); r jsonb; p jsonb;
BEGIN
  PERFORM relay_private.open_room(h);
  r:=relay_private.persist_operation(h,'synthetic-a',20,'AQIDBA==');
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Durable write failed'; END IF;
  r:=relay_private.persist_operation(h,'synthetic-a',20,'AQIDBA==');
  IF r->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Retry was not idempotent'; END IF;
  r:=relay_private.persist_operation(h,'synthetic-a',20,'YQ==');
  IF r->>'ok'<>'true' OR r->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Re-encrypted stable-ID retry not acknowledged'; END IF;
  PERFORM relay_private.persist_operation(h,'synthetic-b',10,'BQY=');
  p:=relay_private.pull_page(h,0,0,1);
  IF p->'frames'<> '["AQIDBA=="]'::jsonb OR p->>'more'<>'true' THEN RAISE EXCEPTION 'First page incorrect'; END IF;
  r:=relay_private.save_checkpoint(h,20,'AQIDBA==',2,0,(p->>'seq')::bigint);
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Checkpoint failed'; END IF;
  r:=relay_private.save_checkpoint(h,30,'YQ==',2,0,0);
  IF r->>'conflict'<>'true' THEN RAISE EXCEPTION 'Stale checkpoint accepted'; END IF;
  r:=relay_private.save_checkpoint(h,999,'YQ==',1,0,0);
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Legacy checkpoint downgraded v2'; END IF;
  p:=relay_private.pull_page(h,0,999999,64);
  IF p->'frames'<> '["AQIDBA==","BQY="]'::jsonb THEN RAISE EXCEPTION 'Stale cursor lost ciphertext'; END IF;
  p:=relay_private.pull_page(repeat('b',64),-1,0,64);
  IF p->'frames'<>'[]'::jsonb THEN RAISE EXCEPTION 'Room isolation failed'; END IF;
  IF has_schema_privilege('anon','relay_private','USAGE') OR has_table_privilege('anon','relay_private.operations','SELECT') THEN RAISE EXCEPTION 'Anonymous table access'; END IF;
  IF has_function_privilege('anon','relay_private.persist_operation(text,text,bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous write access'; END IF;
END $test$;
SELECT 'synthetic persistence, cursor, conflict and isolation assertions completed' AS evidence;
ROLLBACK;
