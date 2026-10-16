-- New, isolated Free project. No customer data or change to the live relay.
BEGIN;
CREATE SCHEMA relay_private;
REVOKE ALL ON SCHEMA relay_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA relay_private TO service_role;

CREATE TABLE relay_private.rooms(
 room_hash text PRIMARY KEY CHECK(room_hash ~ '^[a-f0-9]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 checkpoint_cipher bytea,
 checkpoint_lam bigint NOT NULL DEFAULT 0,
 checkpoint_version smallint NOT NULL DEFAULT 1 CHECK(checkpoint_version IN(1,2))
);
CREATE TABLE relay_private.operations(
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_hash text NOT NULL REFERENCES relay_private.rooms(room_hash),
 op_id text NOT NULL CHECK(length(op_id)>0 AND octet_length(op_id)<=1024),
 lam bigint NOT NULL CHECK(lam BETWEEN -9007199254740991 AND 9007199254740991),
 cipher bytea NOT NULL CHECK(octet_length(cipher)<=262144),
 UNIQUE(room_hash,op_id)
);
CREATE INDEX relay_operations_room_sequence ON relay_private.operations(room_hash,seq);
ALTER TABLE relay_private.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_private.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA relay_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA relay_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION relay_private.open_room(p_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
 INSERT INTO relay_private.rooms(room_hash) VALUES(p_hash) ON CONFLICT DO NOTHING;
$$;

CREATE FUNCTION relay_private.persist_operation(p_hash text,p_id text,p_lam bigint,p_cipher text) RETURNS jsonb
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
 IF FOUND THEN RETURN jsonb_build_object('ok',previous=payload,'duplicate',previous=payload,'conflict',previous<>payload); END IF;
 INSERT INTO relay_private.operations(room_hash,op_id,lam,cipher) VALUES(p_hash,p_id,p_lam,payload);
 RETURN jsonb_build_object('ok',true,'duplicate',false);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'reason','storage-unavailable');
END $$;

CREATE FUNCTION relay_private.save_checkpoint(p_hash text,p_lam bigint,p_cipher text,p_version integer,p_revision bigint,p_sequence bigint) RETURNS jsonb
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
  UPDATE relay_private.rooms SET checkpoint_cipher=payload,checkpoint_lam=p_lam WHERE room_hash=p_hash;
  DELETE FROM relay_private.operations WHERE room_hash=p_hash AND lam<=p_lam;
 END IF;
 RETURN jsonb_build_object('ok',true,'conflict',false);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'conflict',false,'reason','storage-unavailable');
END $$;

CREATE FUNCTION relay_private.pull_page(p_hash text,p_revision bigint,p_sequence bigint,p_limit integer DEFAULT 64) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; frames jsonb:='[]'::jsonb; row record; current_seq bigint:=greatest(coalesce(p_sequence,0),0); page_size integer:=least(128,greatest(coalesce(p_limit,64),1)); n integer:=0;
BEGIN
 -- A shared row lock makes checkpoint + operation-page one coherent cut.
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('frames',frames,'v',2,'rev',0,'seq',0,'n',0,'more',false); END IF;
 IF p_revision IS DISTINCT FROM room.revision THEN
  current_seq:=0;
  IF room.checkpoint_cipher IS NOT NULL THEN frames:=frames||jsonb_build_array(replace(encode(room.checkpoint_cipher,'base64'),E'\n','')); END IF;
 END IF;
 FOR row IN SELECT seq,cipher FROM relay_private.operations WHERE room_hash=p_hash AND seq>current_seq ORDER BY seq LIMIT page_size LOOP
  frames:=frames||jsonb_build_array(replace(encode(row.cipher,'base64'),E'\n',''));current_seq:=row.seq;n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('frames',frames,'v',2,'rev',room.revision,'seq',current_seq,'n',n,'more',n=page_size);
END $$;

CREATE FUNCTION relay_private.pull_legacy(p_hash text,p_lam bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE room relay_private.rooms; frames jsonb:='[]'::jsonb; cursor_lam bigint:=coalesce(p_lam,0); row record;
BEGIN
 SELECT * INTO room FROM relay_private.rooms WHERE room_hash=p_hash FOR SHARE;
 IF NOT FOUND THEN RETURN frames; END IF;
 IF room.checkpoint_cipher IS NOT NULL AND room.checkpoint_lam>cursor_lam THEN
  frames:=frames||jsonb_build_array(replace(encode(room.checkpoint_cipher,'base64'),E'\n',''));cursor_lam:=room.checkpoint_lam;
 END IF;
 FOR row IN SELECT cipher FROM relay_private.operations WHERE room_hash=p_hash AND (room.checkpoint_version>=2 OR lam>cursor_lam) ORDER BY CASE WHEN room.checkpoint_version<2 THEN lam END,seq LIMIT 128 LOOP
  frames:=frames||jsonb_build_array(replace(encode(row.cipher,'base64'),E'\n',''));
 END LOOP;
 RETURN frames;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA relay_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA relay_private TO service_role;
-- Grant no direct table access. Functions are the only backend entry points.
COMMIT;
