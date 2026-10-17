-- Preserve the encrypted recovery protocol while avoiding quadratic JSON copies.
-- Large photo pages must fit the existing anon query budget; no timeout increase.
BEGIN;
CREATE OR REPLACE FUNCTION relay_private.pull_page(p_hash text,p_revision bigint,p_sequence bigint,p_limit integer DEFAULT 64) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; frames jsonb:='[]'::jsonb; page_frames jsonb;
 current_seq bigint:=greatest(coalesce(p_sequence,0),0);
 page_size integer:=least(128,greatest(coalesce(p_limit,64),1)); n integer:=0;
BEGIN
 -- Keep the original coherent checkpoint/page cut and row-lock lifetime.
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('frames',frames,'v',2,'rev',0,'seq',0,'n',0,'more',false); END IF;
 IF p_revision IS DISTINCT FROM room.revision THEN
  current_seq:=0;
  IF room.checkpoint_cipher IS NOT NULL THEN frames:=jsonb_build_array(replace(encode(room.checkpoint_cipher,'base64'),E'\\n','')); END IF;
 END IF;
 -- Aggregate a bounded ordered page once. Appending a growing jsonb array for
 -- each frame repeatedly copied all preceding photo bytes and could time out.
 SELECT coalesce(jsonb_agg(replace(encode(page.cipher,'base64'),E'\\n','') ORDER BY page.seq),'[]'::jsonb),
  coalesce(max(page.seq),current_seq),count(*)
 INTO page_frames,current_seq,n
 FROM (SELECT seq,cipher FROM relay_private.operations
       WHERE room_hash=p_hash AND seq>current_seq ORDER BY seq LIMIT page_size) AS page;
 RETURN jsonb_build_object('frames',frames||page_frames,'v',2,'rev',room.revision,
  'seq',current_seq,'n',n,'more',n=page_size);
END $$;
COMMENT ON FUNCTION relay_private.pull_page(text,bigint,bigint,integer) IS
 'Coherent bounded encrypted recovery page; one ordered aggregation preserves checkpoint-first frames, generation reset, cursor and legacy exact-boundary more semantics without repeated large JSON copies.';
COMMIT;
