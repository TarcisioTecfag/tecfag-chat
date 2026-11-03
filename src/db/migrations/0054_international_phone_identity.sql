DROP INDEX IF EXISTS contacts_tenant_phone_identity_unique;

CREATE OR REPLACE FUNCTION contact_phone_identity(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
  national text;
  ddd text;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(value, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;

  -- Auto-cura para números NANP (EUA/Canadá) que receberam prefixo 55 por engano (13 dígitos iniciando com 551 + Area Code N[0-8]X)
  IF digits ~ '^551[2-9][0-8][0-9]{8}$' THEN
    RETURN substr(digits, 3);
  END IF;

  -- Números internacionais explícitos com '+' (exceto +55) ou números NANP (+1 EUA/Canadá de 11 dígitos)
  IF (btrim(value) LIKE '+%' AND digits !~ '^55') OR digits ~ '^1[2-9][0-8][0-9]{8}$' THEN
    RETURN digits;
  END IF;

  -- Números brasileiros com ou sem DDI 55
  IF digits ~ '^55[0-9]{10,11}$' THEN
    national := substr(digits, 3);
  ELSE
    national := digits;
  END IF;

  IF length(national) IN (10, 11) THEN
    ddd := substr(national, 1, 2);
    -- Verifica se o DDD pertence à lista oficial da Anatel e se o formato local é válido no Brasil
    IF ddd ~ '^(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$'
       AND ((length(national) = 10 AND substr(national, 3, 1) ~ '^[2-9]$')
            OR (length(national) = 11 AND substr(national, 3, 1) = '9')) THEN
      IF length(national) = 11 AND substr(national, 3, 2) ~ '^9[6-9]' THEN
        national := ddd || substr(national, 4);
      END IF;
      RETURN '55' || national;
    END IF;
  END IF;

  RETURN digits;
END;
$$;

-- Auto-cura de contatos dos EUA/Canadá que foram salvos com '551...' no passado (apenas quando não houver conflito no mesmo tenant)
UPDATE contacts c
SET phone = substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 3)
WHERE regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') ~ '^551[2-9][0-8][0-9]{8}$'
  AND NOT EXISTS (
    SELECT 1
    FROM contacts other
    WHERE other.tenant_id = c.tenant_id
      AND other.id <> c.id
      AND contact_phone_identity(other.phone) = substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 3)
  );

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_identity_unique
  ON contacts (tenant_id, contact_phone_identity(phone))
  WHERE contact_phone_identity(phone) IS NOT NULL;
