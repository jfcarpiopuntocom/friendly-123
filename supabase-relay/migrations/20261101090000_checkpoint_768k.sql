-- JFC approved cap increase (1 Nov 2026); apply only after a numeric capacity audit.
-- No table rewrite, no operation-cap change, no authorization/grant change.
-- Function bodies copied from original migrations; only ckpt limit and pull budget differ.
BEGIN;
CREATE OR REPLACE FUNCTION relay_private.save_checkpoint(p_hash text,p_lam bigint,p_cipher text,p_version integer,p_revision bigint,p_sequence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; payload bytea; last_sequence bigint;
BEGIN
 payload:=decode(p_cipher,'base64');
 IF p_cipher IS NULL OR octet_length(payload)>786432 OR p_version NOT IN(1,2) THEN RETURN jsonb_build_object('ok',false,'conflict',false); END IF;
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'conflict',false); END IF;
 IF room.checkpoint_cipher=payload THEN RETURN jsonb_build_object('ok',true,'conflict',false,'duplicate',true); END IF;
 IF p_version=2 THEN
  IF p_revision IS DISTINCT FROM room.revision THEN RETURN jsonb_build_object('ok',false,'conflict',true); END IF;
  SELECT coalesce(max(seq),0) INTO last_sequence FROM relay_private.operations WHERE room_hash=p_hash;
  IF p_sequence IS NULL OR p_sequence<0 OR p_sequence>last_sequence THEN RETURN jsonb_build_object('ok',false,'conflict',false); END IF;
  UPDATE relay_private.rooms SET checkpoint_cipher=payload,checkpoint_lam=p_lam,checkpoint_version=2,revision=revision+1 WHERE room_hash=p_hash;
  DELETE FROM relay_private.operations WHERE room_hash=p_hash AND seq<=p_sequence;
 ELSE
  IF room.checkpoint_version>=2 OR room.checkpoint_cipher IS NOT NULL AND room.checkpoint_lam>p_lam THEN RETURN jsonb_build_object('ok',false,'conflict',false); END IF;
  UPDATE relay_private.rooms SET checkpoint_cipher=payload,checkpoint_lam=p_lam WHERE room_hash=p_hash;
  DELETE FROM relay_private.operations WHERE room_hash=p_hash AND lam<=p_lam;
 END IF;
 RETURN jsonb_build_object('ok',true,'conflict',false);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'conflict',false,'reason','storage-unavailable');
END $$;

CREATE OR REPLACE FUNCTION relay_private.pull_page(p_hash text,p_revision bigint,p_sequence bigint,p_limit integer DEFAULT 64) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; frames jsonb:='[]'::jsonb; page_frames jsonb;
 current_seq bigint:=greatest(coalesce(p_sequence,0),0);
 page_size integer:=least(128,greatest(coalesce(p_limit,64),1)); n integer:=0;
 budget bigint:=1048576;
BEGIN
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('frames',frames,'v',2,'rev',0,'seq',0,'n',0,'more',false); END IF;
 IF p_revision IS DISTINCT FROM room.revision THEN
  current_seq:=0;
  IF room.checkpoint_cipher IS NOT NULL THEN
   frames:=jsonb_build_array(replace(encode(room.checkpoint_cipher,'base64'),E'\\n',''));
   budget:=greatest(0,1048576-octet_length(room.checkpoint_cipher));
  END IF;
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
 FROM sized WHERE bytes<=budget OR position=1;
 RETURN jsonb_build_object('frames',frames||page_frames,'v',2,'rev',room.revision,
  'seq',current_seq,'n',n,'more',n=page_size OR EXISTS(
   SELECT 1 FROM relay_private.operations WHERE room_hash=p_hash AND seq>current_seq
  ));
END $$;
COMMENT ON FUNCTION relay_private.pull_page(text,bigint,bigint,integer) IS
 'Coherent checkpoint-first recovery: up to 768KiB checkpoint, with its ciphertext size deducted from the 1MiB total page budget; first operation still advances. Same room authorization, generation, ciphertext and cursor.';
COMMIT;
