-- Operator HMAC wrapper for exact encrypted export pages. Requires provision.sql
-- secret table and staged-import.sql. Never install the secret in a public asset.
BEGIN;
CREATE FUNCTION public.f123_relay_stage_import_signed(
 p_hash text,p_token text,p_after bigint,p_source text,p_sha256 text,p_issued_at bigint,p_signature text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,relay_private AS $$
DECLARE shared_secret text; expected bytea;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
 OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$'
 OR p_after IS NULL OR p_after<0
 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
 OR p_signature IS NULL OR p_signature !~ '^[a-f0-9]{64}$'
 OR p_issued_at IS NULL OR abs(extract(epoch from clock_timestamp())*1000-p_issued_at::numeric)>60000
 OR p_source IS NULL OR octet_length(p_source)>16777216 THEN
  RAISE insufficient_privilege USING MESSAGE='Import not authorized';
 END IF;
 SELECT secret INTO shared_secret FROM relay_private.provisioning_secret WHERE singleton;
 IF shared_secret IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Import not authorized'; END IF;
 -- The key is the UTF-8 text of the 64 hex characters, matching provisioning.
 -- No newline follows the source SHA. Signature binds the exact source bytes
 -- through SHA-256; the digest is checked before stage_import_page can write.
 expected:=extensions.hmac(convert_to('friendly-import:v1'||chr(10)||p_issued_at::text||chr(10)||p_hash||chr(10)||p_token||chr(10)||p_after::text||chr(10)||p_sha256,'UTF8'),
  convert_to(shared_secret,'UTF8'),'sha256');
 IF expected IS DISTINCT FROM decode(p_signature,'hex') OR
  extensions.digest(p_source,'sha256') IS DISTINCT FROM decode(p_sha256,'hex') THEN
  RAISE insufficient_privilege USING MESSAGE='Import not authorized';
 END IF;
 RETURN relay_private.stage_import_page(p_hash,p_token,p_after,p_source,p_sha256);
END $$;
REVOKE ALL ON FUNCTION public.f123_relay_stage_import_signed(text,text,bigint,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f123_relay_stage_import_signed(text,text,bigint,text,text,bigint,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.f123_relay_stage_import_signed(text,text,bigint,text,text,bigint,text) IS
 'Operator-only possession of private provisioning HMAC secret, timestamp and exact page SHA. Public invocation grants no table access; delegates inactive/idempotent staged import. Does not activate or fence rooms.';
COMMIT;
