-- Operator-only staged import. Apply only to an isolated database for acceptance.
-- It never activates transport, changes the source, or proves a source fence.
BEGIN;
CREATE TABLE relay_private.import_sessions (
 room_hash text PRIMARY KEY REFERENCES relay_private.rooms(room_hash),
 token text NOT NULL CHECK(token ~ '^[a-f0-9]{64}$'),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_min bigint NOT NULL, source_max bigint NOT NULL, source_after bigint NOT NULL,
 CHECK(source_min>=0 AND source_max>=source_min AND source_after>=0 AND source_after<=source_max)
);
CREATE TABLE relay_private.import_pages (
 room_hash text NOT NULL REFERENCES relay_private.import_sessions(room_hash),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_after bigint NOT NULL, PRIMARY KEY(room_hash,source_sha256)
);
ALTER TABLE relay_private.import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_private.import_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON relay_private.import_sessions,relay_private.import_pages FROM PUBLIC,anon,authenticated;

CREATE FUNCTION relay_private.stage_import_page(p_hash text,p_token text,p_after bigint,p_source text,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE page jsonb; cut jsonb; checkpoint jsonb; entry jsonb; session relay_private.import_sessions;
 room relay_private.rooms; payload bytea; cursor_seq bigint; min_seq bigint; max_seq bigint; rev bigint;
 fingerprint text; duplicate_after bigint;
BEGIN
 IF p_source IS NULL OR octet_length(p_source)>16777216 OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$'
 OR p_sha256 IS DISTINCT FROM encode(extensions.digest(p_source,'sha256'),'hex') OR p_after IS NULL OR p_after<0 THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid-page');
 END IF;
 page:=p_source::jsonb;cut:=page->'cut';checkpoint:=page->'checkpoint';
 min_seq:=(cut->>'minSeq')::bigint;max_seq:=(cut->>'maxSeq')::bigint;fingerprint:=cut->>'fingerprint';
 IF page->>'v' IS DISTINCT FROM '1' OR jsonb_typeof(page->'ops') IS DISTINCT FROM 'array'
 OR fingerprint IS NULL OR fingerprint !~ '^[a-f0-9]{64}$' OR min_seq IS NULL OR max_seq IS NULL
 OR min_seq<0 OR max_seq<min_seq OR p_after>max_seq THEN RAISE invalid_parameter_value; END IF;
 -- The room lock also serializes activation and public durable commands.
 PERFORM relay_private.open_room(p_hash);
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR UPDATE;
 IF room.transport_active THEN RETURN jsonb_build_object('ok',false,'reason','target-active'); END IF;
 SELECT * INTO session FROM relay_private.import_sessions WHERE room_hash=p_hash;
 IF FOUND THEN
  IF session.token<>p_token THEN RETURN jsonb_build_object('ok',false,'reason','wrong-session'); END IF;
  SELECT source_after INTO duplicate_after FROM relay_private.import_pages WHERE room_hash=p_hash AND source_sha256=p_sha256;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'after',duplicate_after); END IF;
  IF session.source_after<>p_after OR session.source_fingerprint<>fingerprint OR
   (session.source_min<>min_seq AND NOT(session.source_max=0 AND session.source_after=0 AND session.source_min=0)) OR
   max_seq<session.source_max OR (max_seq<>session.source_max AND session.source_after<>session.source_max) OR
   (checkpoint IS NOT NULL AND checkpoint<>'null'::jsonb) THEN
   RETURN jsonb_build_object('ok',false,'reason','source-cut-changed');
  END IF;
 ELSE
  IF p_after<>0 OR room.revision<>0 OR room.checkpoint_cipher IS NOT NULL OR
   EXISTS(SELECT 1 FROM relay_private.operations WHERE room_hash=p_hash) OR
   EXISTS(SELECT 1 FROM relay_private.imports WHERE room_hash=p_hash) THEN
   RETURN jsonb_build_object('ok',false,'reason','target-not-empty');
  END IF;
  rev:=coalesce((checkpoint->>'rev')::bigint,0);
  IF rev<0 THEN RAISE invalid_parameter_value; END IF;
  IF checkpoint IS NOT NULL AND checkpoint<>'null'::jsonb THEN
   payload:=decode(checkpoint->>'c','base64');
   IF payload IS NULL OR octet_length(payload)>262144 OR coalesce((checkpoint->>'v')::integer,1) NOT IN(1,2) THEN RAISE invalid_parameter_value; END IF;
   UPDATE relay_private.rooms SET revision=rev+1,checkpoint_cipher=payload,
    checkpoint_lam=(checkpoint->>'lam')::bigint,checkpoint_version=coalesce((checkpoint->>'v')::integer,1) WHERE room_hash=p_hash;
  ELSE UPDATE relay_private.rooms SET revision=rev+1 WHERE room_hash=p_hash; END IF;
  INSERT INTO relay_private.import_sessions VALUES(p_hash,p_token,fingerprint,min_seq,max_seq,0);
 END IF;
 cursor_seq:=p_after;
 FOR entry IN SELECT value FROM jsonb_array_elements(page->'ops') LOOP
  IF (entry->>'seq')::bigint IS NULL OR (entry->>'seq')::bigint<=cursor_seq OR (entry->>'seq')::bigint>max_seq OR
   (cursor_seq=0 AND (entry->>'seq')::bigint IS DISTINCT FROM min_seq) THEN RAISE invalid_parameter_value; END IF;
  cursor_seq:=(entry->>'seq')::bigint;
  -- No ON CONFLICT: a repeated ID in a different page is a corrupt archive,
  -- not a permission to replace the original ciphertext or skip a source row.
  INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher)
   VALUES(p_hash,entry->>'id',(entry->>'lam')::bigint,decode(entry->>'c','base64'));
 END LOOP;
 IF (page->>'after')::bigint IS DISTINCT FROM cursor_seq OR
  (page->>'more')::boolean IS DISTINCT FROM (cursor_seq<max_seq) OR
  (cursor_seq=p_after AND cursor_seq<max_seq) THEN RAISE invalid_parameter_value; END IF;
 UPDATE relay_private.import_sessions SET source_min=min_seq,source_max=max_seq,source_after=cursor_seq WHERE room_hash=p_hash;
 INSERT INTO relay_private.import_pages VALUES(p_hash,p_sha256,cursor_seq);
 RETURN jsonb_build_object('ok',true,'duplicate',false,'after',cursor_seq,'copyComplete',cursor_seq=max_seq,
  'transportActive',false,'sourceFenced',false);
EXCEPTION WHEN others THEN
 -- PL/pgSQL exception subtransaction rolls back this entire page and its cursor.
 RETURN jsonb_build_object('ok',false,'reason','invalid-or-unavailable-page');
END $$;
REVOKE ALL ON FUNCTION relay_private.stage_import_page(text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION relay_private.stage_import_page(text,text,bigint,text,text) TO service_role;
COMMENT ON FUNCTION relay_private.stage_import_page(text,text,bigint,text,text) IS
 'Private inactive staging only. Exact page checksum, atomic append, same-session tail, no aggregate 16MiB limit. Complete copy is not cutover readiness; no source writer fence or activation.';
COMMIT;
