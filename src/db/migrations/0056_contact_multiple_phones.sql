-- 0056_contact_multiple_phones.sql
-- Arquitetura Multi-Telefone por Contato (1:N ilimitado) com Atendimentos/Chats Separados por Número:
-- 1. Garante função imutável contact_phone_identity(text)
-- 2. Cria tabela contact_phones (comercial, pessoal, fixo, whatsapp, financeiro, outro)
-- 3. Faz backfill automático do telefone principal atual de cada contato em contact_phones
-- 4. Adiciona contact_phone_id e contact_phone em conversations com índices únicos por número
-- 5. Atualiza triggers de proteção de identidade telefônica por tenant (permitindo N números no mesmo contact_id e bloqueando duplicidade entre contatos distintos)

CREATE OR REPLACE FUNCTION contact_phone_identity(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
  national text;
  ddd text;
BEGIN
  IF digits = '' THEN
    RETURN '';
  END IF;

  IF digits ~ '^551[2-9][0-8][0-9]{8}$' THEN
    RETURN substr(digits, 3);
  END IF;

  IF (btrim(coalesce(value, '')) LIKE '+%' AND digits !~ '^55') OR digits ~ '^1[2-9][0-8][0-9]{8}$' THEN
    RETURN digits;
  END IF;

  national := digits;
  IF digits LIKE '55%' AND length(digits) IN (12, 13) THEN
    national := substr(digits, 3);
  END IF;

  IF length(national) IN (10, 11) THEN
    ddd := substr(national, 1, 2);
    IF ddd ~ '^(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$' THEN
      IF length(national) = 11 AND substr(national, 3) ~ '^9[6-9][0-9]{7}$' THEN
        national := ddd || substr(national, 4);
      END IF;
      IF length(national) = 10 AND substr(national, 3) ~ '^[2-9][0-9]{7}$' THEN
        RETURN '55' || national;
      END IF;
    END IF;
  END IF;

  RETURN digits;
END;
$$;

CREATE TABLE IF NOT EXISTS contact_phones (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone text NOT NULL,
  phone_identity text NOT NULL,
  type text NOT NULL DEFAULT 'commercial',
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  has_whatsapp boolean NOT NULL DEFAULT true,
  whatsapp_jid text,
  whatsapp_user_id text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_phones_tenant_contact
  ON contact_phones (tenant_id, contact_id, is_primary DESC, position ASC);

CREATE INDEX IF NOT EXISTS idx_contact_phones_tenant_identity
  ON contact_phones (tenant_id, phone_identity);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_phones_contact_identity_uniq
  ON contact_phones (tenant_id, contact_id, phone_identity)
  WHERE phone_identity <> '';

-- Backfill dos telefones atuais de contacts para contact_phones como número principal
INSERT INTO contact_phones (
  id,
  tenant_id,
  contact_id,
  phone,
  phone_identity,
  type,
  label,
  is_primary,
  has_whatsapp,
  whatsapp_jid,
  whatsapp_user_id,
  position,
  created_at,
  updated_at
)
SELECT
  'cph-' || c.id || '-primary',
  c.tenant_id,
  c.id,
  btrim(c.phone),
  contact_phone_identity(c.phone),
  CASE
    WHEN contact_phone_identity(c.phone) ~ '^55[1-9][0-9][2-5][0-9]{7}$' THEN 'landline'
    ELSE 'commercial'
  END,
  NULL,
  true,
  true,
  c.whatsapp_jid,
  c.whatsapp_user_id,
  0,
  COALESCE(c.created_at, now()),
  now()
FROM contacts c
WHERE c.phone IS NOT NULL
  AND btrim(c.phone) <> ''
  AND contact_phone_identity(c.phone) <> ''
ON CONFLICT (tenant_id, contact_id, phone_identity) WHERE phone_identity <> ''
DO NOTHING;

-- Colunas de vínculo de telefone específico na conversa (permitindo chats separados por número do mesmo contato)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS contact_phone_id text REFERENCES contact_phones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_phone text;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_contact_phone
  ON conversations (tenant_id, contact_id, contact_phone_id);

-- Atualiza os índices únicos de conversations para permitir 1 conversa por (contato + número de telefone) em cada conexão
DROP INDEX IF EXISTS idx_conversations_tenant_contact_uniq;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM conversations
    WHERE whatsapp_connection_id IS NULL
    GROUP BY tenant_id, contact_id, COALESCE(contact_phone_id, '')
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX idx_conversations_tenant_contact_uniq
      ON conversations (tenant_id, contact_id, COALESCE(contact_phone_id, ''))
      WHERE whatsapp_connection_id IS NULL;
  ELSE
    RAISE WARNING 'Legacy duplicate conversations preserved; review before enforcing corporate uniqueness';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_conversations_connection_contact_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_connection_contact_uniq
  ON conversations (tenant_id, whatsapp_connection_id, contact_id, COALESCE(contact_phone_id, ''))
  WHERE whatsapp_connection_id IS NOT NULL;

-- Backfill das conversas existentes com o telefone principal do contato (após os índices DDL para evitar pendência de gatilhos na tabela conversations)
UPDATE conversations conv
SET
  contact_phone_id = cp.id,
  contact_phone = cp.phone
FROM contact_phones cp
WHERE conv.tenant_id = cp.tenant_id
  AND conv.contact_id = cp.contact_id
  AND cp.is_primary = true
  AND conv.contact_phone_id IS NULL;

-- Atualiza guard_contact_phone_identity() na tabela contacts:
-- Bloqueia apenas se OUTRO contato (c.id <> NEW.id) no mesmo tenant já possuir o telefone em contacts ou contact_phones.
CREATE OR REPLACE FUNCTION guard_contact_phone_identity() RETURNS trigger AS $$
DECLARE
  identity_key text := contact_phone_identity(NEW.phone);
BEGIN
  IF length(identity_key) < 8 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND identity_key = contact_phone_identity(OLD.phone) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(identity_key));
  IF EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.id <> NEW.id
      AND contact_phone_identity(c.phone) = identity_key
  ) OR EXISTS (
    SELECT 1
    FROM contact_phones cp
    WHERE cp.tenant_id = NEW.tenant_id
      AND cp.contact_id <> NEW.id
      AND cp.phone_identity = identity_key
  ) THEN
    RAISE EXCEPTION 'Já existe um contato com este telefone neste tenant.'
      USING ERRCODE = '23505', CONSTRAINT = 'contacts_tenant_phone_identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_phone_identity ON contacts;
CREATE TRIGGER trg_contact_phone_identity
  BEFORE INSERT OR UPDATE OF phone, tenant_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION guard_contact_phone_identity();

-- Guard para a tabela contact_phones:
-- Preenche phone_identity automaticamente e impede que dois contatos distintos compartilhem o mesmo número no tenant,
-- enquanto permite que o MESMO contact_id tenha quantos números distintos precisar.
CREATE OR REPLACE FUNCTION guard_contact_phones_entry() RETURNS trigger AS $$
DECLARE
  identity_key text := contact_phone_identity(NEW.phone);
BEGIN
  NEW.phone := btrim(coalesce(NEW.phone, ''));
  NEW.phone_identity := identity_key;
  IF length(identity_key) < 8 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id
     AND NEW.contact_id = OLD.contact_id
     AND identity_key = OLD.phone_identity THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id), hashtext(identity_key));
  IF EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.id <> NEW.contact_id
      AND contact_phone_identity(c.phone) = identity_key
  ) OR EXISTS (
    SELECT 1
    FROM contact_phones cp
    WHERE cp.tenant_id = NEW.tenant_id
      AND cp.contact_id <> NEW.contact_id
      AND cp.phone_identity = identity_key
  ) THEN
    RAISE EXCEPTION 'Já existe outro contato com este telefone neste tenant.'
      USING ERRCODE = '23505', CONSTRAINT = 'contacts_tenant_phone_identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_contact_phones_entry ON contact_phones;
CREATE TRIGGER trg_guard_contact_phones_entry
  BEFORE INSERT OR UPDATE OF phone, phone_identity, tenant_id, contact_id ON contact_phones
  FOR EACH ROW EXECUTE FUNCTION guard_contact_phones_entry();

-- Sincronização automática unidirecional (contacts -> contact_phones principal) para escritas legadas diretas em contacts
CREATE OR REPLACE FUNCTION sync_primary_contact_phone_from_contacts() RETURNS trigger AS $$
DECLARE
  v_identity text := contact_phone_identity(NEW.phone);
BEGIN
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' OR v_identity = '' THEN
    RETURN NEW;
  END IF;

  UPDATE contact_phones
  SET is_primary = false, updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND contact_id = NEW.id
    AND is_primary = true
    AND phone_identity <> v_identity;

  INSERT INTO contact_phones (
    id,
    tenant_id,
    contact_id,
    phone,
    phone_identity,
    type,
    is_primary,
    has_whatsapp,
    whatsapp_jid,
    whatsapp_user_id,
    position,
    created_at,
    updated_at
  ) VALUES (
    'cph-' || NEW.id || '-' || substr(md5(v_identity), 1, 10),
    NEW.tenant_id,
    NEW.id,
    btrim(NEW.phone),
    v_identity,
    CASE WHEN v_identity ~ '^55[1-9][0-9][2-5][0-9]{7}$' THEN 'landline' ELSE 'commercial' END,
    true,
    true,
    NEW.whatsapp_jid,
    NEW.whatsapp_user_id,
    0,
    COALESCE(NEW.created_at, now()),
    now()
  )
  ON CONFLICT (tenant_id, contact_id, phone_identity) WHERE phone_identity <> ''
  DO UPDATE SET
    phone = EXCLUDED.phone,
    is_primary = true,
    whatsapp_jid = COALESCE(EXCLUDED.whatsapp_jid, contact_phones.whatsapp_jid),
    whatsapp_user_id = COALESCE(EXCLUDED.whatsapp_user_id, contact_phones.whatsapp_user_id),
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_primary_contact_phone ON contacts;
CREATE TRIGGER trg_sync_primary_contact_phone
  AFTER INSERT OR UPDATE OF phone, whatsapp_jid, whatsapp_user_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_primary_contact_phone_from_contacts();
