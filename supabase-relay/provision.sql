-- Licensing-only, HMAC-authenticated provisioning. No customer history import.
-- Operator installs the shared secret separately; never place it in this file.
BEGIN;
CREATE TABLE relay_private.provisioning_secret (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 secret text NOT NULL CHECK(secret ~ '^[a-f0-9]{64}$')
);
ALTER TABLE relay_private.provisioning_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON relay_private.provisioning_secret FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.f123_relay_provision(p_rooms text[],p_issued_at bigint,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE shared_secret text; expected text; room text; hashes text[]; existing_count integer;
 active_count integer; ready_count integer:=0; created_count integer:=0; pending_count integer:=0;
BEGIN
 IF p_rooms IS NULL OR array_ndims(p_rooms) IS DISTINCT FROM 1 OR cardinality(p_rooms) NOT BETWEEN 1 AND 500
 OR EXISTS(SELECT 1 FROM unnest(p_rooms) AS r WHERE r IS NULL OR r !~ '^[a-f0-9]{40}$')
 OR p_issued_at IS NULL OR abs(extract(epoch from clock_timestamp())*1000-p_issued_at::numeric)>60000
 OR p_signature IS NULL OR p_signature !~ '^[a-f0-9]{64}$' THEN
  RAISE insufficient_privilege USING MESSAGE='Provisioning not authorized';
 END IF;
 SELECT secret INTO shared_secret FROM relay_private.provisioning_secret WHERE singleton;
 IF shared_secret IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Provisioning not authorized'; END IF;
 expected:=encode(extensions.hmac(convert_to('friendly-provision:v1'||chr(10)||p_issued_at::text||chr(10)||array_to_string(p_rooms,chr(10)),'UTF8'),
  convert_to(shared_secret,'UTF8'),'sha256'),'hex');
 IF expected<>p_signature THEN RAISE insufficient_privilege USING MESSAGE='Provisioning not authorized'; END IF;
 -- Sort locks so overlapping batches cannot acquire group locks in reverse order.
 FOR room IN SELECT DISTINCT r FROM unnest(p_rooms) AS r ORDER BY r LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('friendly-provision:'||room,0));
  SELECT array_agg(encode(extensions.digest('friendly-relay:'||room||suffix,'sha256'),'hex')) INTO hashes
   FROM (VALUES(''),('-y'),('-ops'),('-fotos')) AS channels(suffix);
  PERFORM 1 FROM relay_private.rooms WHERE room_hash=ANY(hashes) ORDER BY room_hash FOR UPDATE;
  SELECT count(*),count(*) FILTER(WHERE transport_active) INTO existing_count,active_count
   FROM relay_private.rooms WHERE room_hash=ANY(hashes);
  IF existing_count=4 AND active_count=4 THEN ready_count:=ready_count+1;
  ELSIF existing_count<>0 THEN pending_count:=pending_count+1;
  ELSE
   INSERT INTO relay_private.rooms(room_hash,transport_active) SELECT h,true FROM unnest(hashes) AS h;
   created_count:=created_count+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',pending_count=0,'ready',ready_count,'created',created_count,'migrationRequired',pending_count);
END $$;
REVOKE ALL ON FUNCTION public.f123_relay_provision(text[],bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f123_relay_provision(text[],bigint,text) TO anon,authenticated;
COMMENT ON FUNCTION public.f123_relay_provision(text[],bigint,text) IS
 'Timestamp-limited HMAC from licensing authority. Atomic new empty four-channel groups only; existing inactive or partial groups require verified migration. No history or source changes.';
COMMIT;
