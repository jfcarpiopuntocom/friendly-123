CREATE OR REPLACE FUNCTION relay_private.persist_operation(p_hash text,p_id text,p_lam bigint,p_cipher text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE previous bytea; payload bytea;
BEGIN
 payload:=decode(p_cipher,'base64');
 IF p_cipher IS NULL OR octet_length(payload)>262144 OR p_id IS NULL OR length(p_id)=0 THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid-frame');
 END IF;
 PERFORM 1 FROM relay_private.rooms WHERE room_hash=p_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','room-unavailable'); END IF;
 SELECT cipher INTO previous FROM relay_private.operations WHERE room_hash=p_hash AND op_id=p_id;
 -- Stable operation IDs are authoritative across retries with fresh AES-GCM IVs.
 -- Keep the first durable envelope without duplicating or replacing it.
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
 INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES(p_hash,p_id,p_lam,payload);
 RETURN jsonb_build_object('ok',true,'duplicate',false);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'reason','storage-unavailable');
END $$;
COMMENT ON FUNCTION relay_private.persist_operation(text,text,bigint,text) IS
 'Existing-client contract: stable operation ID is authoritative across AES-GCM retries with fresh IV; first committed envelope is retained.';
