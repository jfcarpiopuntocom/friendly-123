-- A bounded ciphertext page prevents REST serialization from exhausting anon's
-- existing query budget. No frame is dropped: more includes the byte boundary.
BEGIN;
CREATE OR REPLACE FUNCTION relay_private.pull_page(p_hash text,p_revision bigint,p_sequence bigint,p_limit integer DEFAULT 64) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; frames jsonb:='[]'::jsonb; page_frames jsonb;
 current_seq bigint:=greatest(coalesce(p_sequence,0),0);
 page_size integer:=least(128,greatest(coalesce(p_limit,64),1)); n integer:=0;
BEGIN
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('frames',frames,'v',2,'rev',0,'seq',0,'n',0,'more',false); END IF;
 IF p_revision IS DISTINCT FROM room.revision THEN
  current_seq:=0;
  IF room.checkpoint_cipher IS NOT NULL THEN frames:=jsonb_build_array(replace(encode(room.checkpoint_cipher,'base64'),E'\\n','')); END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT seq,cipher FROM relay_private.operations
  WHERE room_hash=p_hash AND seq>current_seq ORDER BY seq LIMIT page_size
 ), sized AS (
  SELECT seq,cipher,sum(octet_length(cipher)) OVER (ORDER BY seq) AS bytes,
   row_number() OVER (ORDER BY seq) AS position FROM candidates
 )
 SELECT coalesce(jsonb_agg(replace(encode(cipher,'base64'),E'\\n','') ORDER BY seq),'[]'::jsonb),
  coalesce(max(seq),current_seq),count(*) INTO page_frames,current_seq,n
 FROM sized WHERE bytes<=1048576 OR position=1;
 RETURN jsonb_build_object('frames',frames||page_frames,'v',2,'rev',room.revision,
  'seq',current_seq,'n',n,'more',n=page_size OR EXISTS(
   SELECT 1 FROM relay_private.operations WHERE room_hash=p_hash AND seq>current_seq
  ));
END $$;
COMMENT ON FUNCTION relay_private.pull_page(text,bigint,bigint,integer) IS
 'Coherent checkpoint-first recovery; ordered ciphertext prefix bounded to 1MiB of operations plus checkpoint. more retains exact caller-size behavior and covers every byte-budget continuation. Same room authorization, generation, ciphertext and cursor.';
COMMIT;
