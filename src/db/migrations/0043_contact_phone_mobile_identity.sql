-- Não altera nem mescla contatos históricos. Protege novas escritas, inclusive concorrentes.
CREATE OR REPLACE FUNCTION contact_phone_identity(value text) RETURNS text AS $$
DECLARE
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
  national text;
BEGIN
  national := digits;
  IF digits LIKE '55%' AND length(digits) IN (12, 13) THEN national := substr(digits, 3); END IF;
  IF length(national) = 11 AND substr(national, 3) ~ '^9[6-9][0-9]{7}$' THEN
    national := substr(national, 1, 2) || substr(national, 4);
  END IF;
  IF length(national) = 10 AND substr(national, 3) ~ '^[2-9][0-9]{7}$' THEN RETURN '55' || national; END IF;
  RETURN digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION guard_contact_phone_identity() RETURNS trigger AS $$
DECLARE
  identity_key text := contact_phone_identity(NEW.phone);
BEGIN
  IF length(identity_key) < 8 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND identity_key = contact_phone_identity(OLD.phone) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(identity_key));
  IF EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id
    AND contact_phone_identity(c.phone) = identity_key) THEN
    RAISE EXCEPTION 'Já existe um contato com este telefone neste tenant.'
      USING ERRCODE = '23505', CONSTRAINT = 'contacts_tenant_phone_identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_phone_identity ON contacts;
CREATE TRIGGER trg_contact_phone_identity BEFORE INSERT OR UPDATE OF phone, tenant_id ON contacts
FOR EACH ROW EXECUTE FUNCTION guard_contact_phone_identity();

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone_identity ON contacts (tenant_id, contact_phone_identity(phone));
