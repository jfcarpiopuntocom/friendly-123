-- Synthetic history larger than one REST response budget; all rows roll back.
BEGIN;
DO $test$
DECLARE
 h text:=encode(extensions.digest('synthetic-bounded-pull-20261017','sha256'),'hex');
 page jsonb; cursor_seq bigint:=0; revision bigint:=0; frames_seen integer:=0;
 op_count integer:=0; i integer; encoded text; expected bytea; elapsed interval; started timestamptz;
BEGIN
 IF EXISTS(SELECT 1 FROM relay_private.rooms WHERE room_hash=h) THEN RAISE EXCEPTION 'Fixture collision'; END IF;
 PERFORM relay_private.open_room(h);
 UPDATE relay_private.rooms SET revision=7,checkpoint_cipher=decode('010203','hex'),
  checkpoint_lam=99,checkpoint_version=2 WHERE room_hash=h;
 INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher)
 SELECT h,'synthetic-bounded-'||q.value,129-q.value,decode(lpad(to_hex(q.value),2,'0')||repeat('25',250*1024-1),'hex')
 FROM generate_series(1,128) AS q(value);
 LOOP
  started:=clock_timestamp();
  page:=relay_private.pull_page(h,revision,cursor_seq,128);
  elapsed:=clock_timestamp()-started;
  IF elapsed>=interval '3 seconds' THEN RAISE EXCEPTION 'Page exceeds anon statement budget'; END IF;
  IF octet_length(page::text)>1500000 THEN RAISE EXCEPTION 'Recovery page exceeds bounded REST budget'; END IF;
  IF page->>'rev'<>'7' OR (page->>'seq')::bigint<=cursor_seq THEN RAISE EXCEPTION 'Recovery failed to advance'; END IF;
  i:=0;
  FOR encoded IN SELECT jsonb_array_elements_text(page->'frames') LOOP
   IF revision=0 AND i=0 THEN expected:=decode('010203','hex');
   ELSE op_count:=op_count+1;expected:=decode(lpad(to_hex(op_count),2,'0')||repeat('25',250*1024-1),'hex'); END IF;
   IF decode(encoded,'base64')<>expected THEN RAISE EXCEPTION 'Checkpoint, frame order or ciphertext changed'; END IF;
   i:=i+1;frames_seen:=frames_seen+1;
  END LOOP;
  cursor_seq:=(page->>'seq')::bigint;revision:=7;
  EXIT WHEN NOT (page->>'more')::boolean;
  IF frames_seen>129 THEN RAISE EXCEPTION 'Duplicate recovery frames'; END IF;
 END LOOP;
 IF op_count<>128 OR frames_seen<>129 THEN RAISE EXCEPTION 'History truncated across byte boundary'; END IF;
 page:=relay_private.pull_page(h,7,cursor_seq,128);
 IF page->'frames'<>'[]'::jsonb OR page->>'more'<>'false' OR page->>'n'<>'0'
 THEN RAISE EXCEPTION 'Terminal page changed'; END IF;
 page:=relay_private.pull_page(h,7,0,1);
 IF page->>'n'<>'1' OR page->>'more'<>'true' THEN RAISE EXCEPTION 'Caller page-size boundary changed'; END IF;
END $test$;
SELECT 'Bounded recovery preserves every synthetic frame in order across all cursors' AS result;
ROLLBACK;
