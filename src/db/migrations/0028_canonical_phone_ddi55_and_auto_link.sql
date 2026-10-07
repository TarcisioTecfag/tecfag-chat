-- 0028_canonical_phone_ddi55_and_auto_link.sql
-- 1. Atualiza a trigger de unicidade e integridade de telefone para normalizar canonicamente com DDI 55
CREATE OR REPLACE FUNCTION guard_contact_phone_identity() RETURNS trigger AS $$
DECLARE
  clean_phone text;
BEGIN
  clean_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');
  IF length(clean_phone) < 8 THEN RETURN NEW; END IF;
  
  -- Normaliza números brasileiros de 10 ou 11 dígitos para o formato canônico com DDI 55
  IF (length(clean_phone) = 10 OR length(clean_phone) = 11) AND NOT clean_phone LIKE '55%' THEN
    clean_phone := '55' || clean_phone;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND clean_phone = regexp_replace(coalesce(OLD.phone, ''), '[^0-9]', '', 'g') THEN
    NEW.phone := clean_phone;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(clean_phone));
  IF EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.tenant_id = NEW.tenant_id AND c.id <> NEW.id
      AND (
        regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = clean_phone
        OR ('55' || regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) = clean_phone
      )
  ) THEN
    RAISE EXCEPTION 'Já existe um contato com este telefone neste tenant.' USING ERRCODE = '23505', CONSTRAINT = 'contacts_tenant_phone_identity';
  END IF;

  NEW.phone := clean_phone;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Atualiza contatos existentes de 10 ou 11 dígitos para ter o prefixo 55 (onde não houver duplicata com 55)
UPDATE contacts c1
SET phone = '55' || regexp_replace(c1.phone, '[^0-9]', '', 'g')
WHERE length(regexp_replace(c1.phone, '[^0-9]', '', 'g')) IN (10, 11)
  AND NOT regexp_replace(c1.phone, '[^0-9]', '', 'g') LIKE '55%'
  AND NOT EXISTS (
    SELECT 1 FROM contacts c2
    WHERE c2.tenant_id = c1.tenant_id
      AND c2.id <> c1.id
      AND regexp_replace(coalesce(c2.phone, ''), '[^0-9]', '', 'g') = ('55' || regexp_replace(c1.phone, '[^0-9]', '', 'g'))
  );

-- 3. Auto-cura e consolidação de dados em contatos duplicados (legado sem 55 vs novo com 55):
-- Enriquecer o contato canônico com 55 com os dados cadastrais (empresa, email, cnpj) do contato sem 55
UPDATE contacts c_target
SET
  account_id = coalesce(c_target.account_id, c_source.account_id),
  email = coalesce(c_target.email, c_source.email),
  cnpj = coalesce(c_target.cnpj, c_source.cnpj)
FROM contacts c_source
WHERE c_source.tenant_id = c_target.tenant_id
  AND c_source.id <> c_target.id
  AND ('55' || regexp_replace(coalesce(c_source.phone, ''), '[^0-9]', '', 'g')) = regexp_replace(coalesce(c_target.phone, ''), '[^0-9]', '', 'g')
  AND (c_target.account_id IS NULL OR c_target.email IS NULL OR c_target.cnpj IS NULL);

-- 4. Auto-vincula os participantes nas negociações para garantir que o contato canônico com 55
-- seja participante de qualquer negociação que pertencia ao contato legado
INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, role, is_primary, created_at)
SELECT
  'dc-merge-' || substr(md5(random()::text), 1, 8),
  c_target.tenant_id,
  dc.deal_id,
  c_target.id,
  dc.role,
  false,
  now()
FROM crm_deal_contacts dc
JOIN contacts c_source ON dc.contact_id = c_source.id AND dc.tenant_id = c_source.tenant_id
JOIN contacts c_target ON c_target.tenant_id = c_source.tenant_id
  AND c_target.id <> c_source.id
  AND ('55' || regexp_replace(coalesce(c_source.phone, ''), '[^0-9]', '', 'g')) = regexp_replace(coalesce(c_target.phone, ''), '[^0-9]', '', 'g')
WHERE NOT EXISTS (
  SELECT 1 FROM crm_deal_contacts dc_existing
  WHERE dc_existing.tenant_id = c_target.tenant_id
    AND dc_existing.deal_id = dc.deal_id
    AND dc_existing.contact_id = c_target.id
);
