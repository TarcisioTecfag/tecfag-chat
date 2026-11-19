-- Aditiva: permite armazenar o token do webhook criptografado para reexibição no painel admin.
-- Fluxos legados mantêm token_encrypted = NULL até eventual rotação manual, sem impacto no recebimento.
ALTER TABLE rd_marketing_flows ADD COLUMN IF NOT EXISTS token_encrypted text;
