-- Mantém a diretriz da 0043: não altera nem exige unicidade retroativa sobre contatos históricos legados,
-- protegendo novas escritas via trigger guard_contact_phone_identity() e índice não-único idx_contacts_tenant_phone_identity.
DROP INDEX IF EXISTS contacts_tenant_phone_identity_unique;
DROP INDEX IF EXISTS idx_contacts_tenant_phone_identity;

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

  -- Auto-cura de identidade para números NANP (EUA/Canadá) que receberam prefixo 55 por engano (13 dígitos iniciando com 551 + Area Code N[0-8]X)
  IF digits ~ '^551[2-9][0-8][0-9]{8}$' THEN
    RETURN substr(digits, 3);
  END IF;

  -- Números internacionais explícitos com '+' (exceto +55) ou números NANP (+1 EUA/Canadá de 11 dígitos)
  IF (btrim(coalesce(value, '')) LIKE '+%' AND digits !~ '^55') OR digits ~ '^1[2-9][0-8][0-9]{8}$' THEN
    RETURN digits;
  END IF;

  -- Números brasileiros com ou sem DDI 55
  national := digits;
  IF digits LIKE '55%' AND length(digits) IN (12, 13) THEN
    national := substr(digits, 3);
  END IF;

  IF length(national) IN (10, 11) THEN
    ddd := substr(national, 1, 2);
    -- Verifica se o DDD pertence à lista oficial da Anatel
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

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone_identity
  ON contacts (tenant_id, contact_phone_identity(phone));
