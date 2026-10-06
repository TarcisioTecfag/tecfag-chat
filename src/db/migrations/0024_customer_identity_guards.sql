-- Rejeita novos conflitos sem tentar mesclar automaticamente registros históricos.
-- Comparação por dígitos para alcançar também cadastros antigos formatados.
CREATE OR REPLACE FUNCTION guard_contact_phone_identity() RETURNS trigger AS $$
DECLARE
  clean_phone text;
BEGIN
  clean_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');
  IF length(clean_phone) < 8 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND clean_phone = regexp_replace(coalesce(OLD.phone, ''), '[^0-9]', '', 'g') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(clean_phone));
  IF EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id
      AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = clean_phone
  ) THEN
    RAISE EXCEPTION 'Já existe um contato com este telefone neste tenant.' USING ERRCODE = '23505', CONSTRAINT = 'contacts_tenant_phone_identity';
  END IF;
  NEW.phone := clean_phone;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_phone_identity ON contacts;
CREATE TRIGGER trg_contact_phone_identity BEFORE INSERT OR UPDATE OF phone, tenant_id ON contacts
FOR EACH ROW EXECUTE FUNCTION guard_contact_phone_identity();

CREATE OR REPLACE FUNCTION guard_account_document_identity() RETURNS trigger AS $$
DECLARE
  clean_document text;
BEGIN
  clean_document := regexp_replace(coalesce(NEW.document, ''), '[^0-9]', '', 'g');
  IF clean_document = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND clean_document = regexp_replace(coalesce(OLD.document, ''), '[^0-9]', '', 'g') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(clean_document));
  IF EXISTS (
    SELECT 1 FROM crm_accounts a
    WHERE a.tenant_id = NEW.tenant_id AND a.id <> NEW.id
      AND regexp_replace(coalesce(a.document, ''), '[^0-9]', '', 'g') = clean_document
  ) THEN
    RAISE EXCEPTION 'Já existe uma empresa ou cliente com este documento neste tenant.' USING ERRCODE = '23505', CONSTRAINT = 'crm_accounts_tenant_document_identity';
  END IF;
  NEW.document := clean_document;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_document_identity ON crm_accounts;
CREATE TRIGGER trg_account_document_identity BEFORE INSERT OR UPDATE OF document, tenant_id ON crm_accounts
FOR EACH ROW EXECUTE FUNCTION guard_account_document_identity();
