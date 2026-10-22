-- Synthetic ephemeral PostgreSQL only: no customer operations or room IDs.
DO $$
DECLARE
 h text := repeat('a',64);
 response jsonb;
 page jsonb;
 seq_hi bigint;
 rev bigint;
BEGIN
 PERFORM relay_private.open_room(h);
 response := relay_private.persist_operation(h,'synthetic-first',1,'YQ==');
 IF response->>'ok' <> 'true' THEN RAISE EXCEPTION 'Failed to save synthetic first op'; END IF;
 SELECT max(seq) INTO seq_hi FROM relay_private.operations WHERE room_hash=h;
 IF seq_hi IS NULL THEN RAISE EXCEPTION 'Missing synthetic op'; END IF;
 response := relay_private.save_checkpoint(h,9,'Y2hlY2twb2ludA==',1,NULL,NULL);
 IF response->>'ok' <> 'true' THEN RAISE EXCEPTION 'Legacy checkpoint rejected'; END IF;
 SELECT revision INTO rev FROM relay_private.rooms WHERE room_hash=h;
 IF rev <> 1 THEN RAISE EXCEPTION 'v1 checkpoint did not advance revision: %', rev; END IF;
 IF EXISTS(SELECT 1 FROM relay_private.operations WHERE room_hash=h AND seq=seq_hi) THEN
   RAISE EXCEPTION 'Synthetic old op not compacted'; END IF;
 page := relay_private.pull_page(h,0,seq_hi,64);
 IF (page->>'rev')::bigint<>1 OR jsonb_array_length(page->'frames')<>1 THEN
   RAISE EXCEPTION 'Old revision did not receive new checkpoint: %',page; END IF;
 response := relay_private.save_checkpoint(h,9,'Y2hlY2twb2ludA==',1,NULL,NULL);
 IF response->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Duplicate checkpoint not idempotent'; END IF;
 SELECT revision INTO rev FROM relay_private.rooms WHERE room_hash=h;
 IF rev<>1 THEN RAISE EXCEPTION 'Duplicate checkpoint bumped revision'; END IF;
 response := relay_private.persist_operation(h,'synthetic-second',10,'Yg==');
 IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'Failed to save second synthetic op'; END IF;
 SELECT max(seq) INTO seq_hi FROM relay_private.operations WHERE room_hash=h;
 response := relay_private.save_checkpoint(h,11,'bmV3LXYy',2,1,seq_hi);
 IF response->>'ok'<>'true' THEN RAISE EXCEPTION 'v2 checkpoint semantics regressed: %',response; END IF;
 SELECT revision INTO rev FROM relay_private.rooms WHERE room_hash=h;
 IF rev<>2 THEN RAISE EXCEPTION 'v2 checkpoint did not advance revision: %',rev; END IF;
 RAISE NOTICE 'PASS: v1 revision bump, replay, duplicate and v2 semantics';
END $$;
