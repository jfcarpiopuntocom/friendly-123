-- Forward-only relay repair (E1): v1 checkpoint compaction MUST advance revision.
-- This file is laboratory-only until explicit release/migration authorization.
-- No new grants to API/anon/authenticated; preserve private SECURITY DEFINER.
BEGIN;
CREATE OR REPLACE FUNCTION relay_private.save_checkpoint(p_hash text,p_lam bigint,p_cipher text,p_version integer,p_revision bigint,p_sequence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; payload bytea; last_sequence bigint;
BEGIN
 payload:=decode(p_cipher,'base64');
 IF p_cipher IS NULL OR octet_length(payload)>262144 OR p_version NOT IN(1,2) THEN RETURN jsonb_build_object('ok',false,'conflict',false); END IF;
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
  UPDATE relay_private.rooms SET checkpoint_cipher=payload,checkpoint_lam=p_lam,revision=revision+1 WHERE room_hash=p_hash;
  DELETE FROM relay_private.operations WHERE room_hash=p_hash AND lam<=p_lam;
 END IF;
 RETURN jsonb_build_object('ok',true,'conflict',false);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'conflict',false,'reason','storage-unavailable');
END $$;
REVOKE ALL ON FUNCTION relay_private.save_checkpoint(text,bigint,text,integer,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION relay_private.save_checkpoint(text,bigint,text,integer,bigint,bigint) TO service_role;
COMMIT;
