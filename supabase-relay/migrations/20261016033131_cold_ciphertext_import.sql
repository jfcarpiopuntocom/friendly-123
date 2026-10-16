BEGIN;
CREATE TABLE relay_private.imports(
 room_hash text PRIMARY KEY REFERENCES relay_private.rooms(room_hash),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE relay_private.imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON relay_private.imports FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.f123_relay_import(p_hash text,p_source text,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE bundle jsonb; checkpoint jsonb; saved text; current_room relay_private.rooms;
 row jsonb; previous_seq bigint:=0; source_seq bigint; source_rev bigint; payload bytea;
BEGIN
 IF p_source IS NULL OR octet_length(p_source)>16777216 OR p_sha256 IS DISTINCT FROM encode(extensions.digest(p_source,'sha256'),'hex') THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid-copy');
 END IF;
 bundle:=p_source::jsonb;checkpoint:=bundle->'checkpoint';
 IF bundle->>'v' IS DISTINCT FROM '1' OR jsonb_typeof(bundle->'ops') IS DISTINCT FROM 'array' THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid-copy');
 END IF;
 PERFORM relay_private.open_room(p_hash);
 SELECT * INTO current_room FROM relay_private.rooms WHERE room_hash=p_hash FOR UPDATE;
 SELECT source_sha256 INTO saved FROM relay_private.imports WHERE room_hash=p_hash;
 IF FOUND THEN RETURN jsonb_build_object('ok',saved=p_sha256,'duplicate',saved=p_sha256,'reason','already-imported'); END IF;
 IF current_room.revision<>0 OR current_room.checkpoint_cipher IS NOT NULL OR EXISTS(SELECT 1 FROM relay_private.operations WHERE room_hash=p_hash) THEN
  RETURN jsonb_build_object('ok',false,'reason','target-not-empty');
 END IF;
 source_rev:=coalesce((checkpoint->>'rev')::bigint,0);
 IF source_rev<0 THEN RAISE invalid_parameter_value; END IF;
 IF checkpoint IS NOT NULL AND checkpoint<>'null'::jsonb THEN
  payload:=decode(checkpoint->>'c','base64');
  IF payload IS NULL OR octet_length(payload)>262144 OR coalesce((checkpoint->>'v')::integer,1) NOT IN(1,2) THEN RAISE invalid_parameter_value; END IF;
  UPDATE relay_private.rooms SET checkpoint_cipher=payload,checkpoint_lam=(checkpoint->>'lam')::bigint,
   checkpoint_version=coalesce((checkpoint->>'v')::integer,1),revision=source_rev+1 WHERE room_hash=p_hash;
 ELSE
  UPDATE relay_private.rooms SET revision=source_rev+1 WHERE room_hash=p_hash;
 END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(bundle->'ops') LOOP
  source_seq:=(row->>'seq')::bigint;
  IF source_seq IS NULL OR source_seq<=previous_seq OR source_seq>(bundle->'cut'->>'maxSeq')::bigint THEN RAISE invalid_parameter_value; END IF;
  IF previous_seq=0 AND source_seq IS DISTINCT FROM (bundle->'cut'->>'minSeq')::bigint THEN RAISE invalid_parameter_value; END IF;
  previous_seq:=source_seq;
  INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher)
   VALUES(p_hash,row->>'id',(row->>'lam')::bigint,decode(row->>'c','base64'));
 END LOOP;
 IF previous_seq IS DISTINCT FROM (bundle->'cut'->>'maxSeq')::bigint THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO relay_private.imports(room_hash,source_sha256) VALUES(p_hash,p_sha256);
 RETURN jsonb_build_object('ok',true,'duplicate',false,'revision',source_rev+1);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'reason','import-unavailable');
END $$;
REVOKE ALL ON FUNCTION public.f123_relay_import(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.f123_relay_import(text,text,text) TO service_role;
COMMENT ON FUNCTION public.f123_relay_import(text,text,text) IS 'Operator-only cold import. Checksum required; first history retained; source remains untouched; new generation invalidates old relay cursors.';
COMMIT;
