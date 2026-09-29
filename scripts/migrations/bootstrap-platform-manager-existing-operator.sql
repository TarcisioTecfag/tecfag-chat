-- O gestor inicial precisa ser vinculado ao tenant onde sua conta de operador já existe.
-- Se houver uma conta em outro tenant além do selecionado na primeira migração,
-- prioriza essa conta para permitir configurar o acesso pela sessão já utilizável.
WITH candidate AS (
  SELECT o.tenant_id
  FROM operators AS o
  LEFT JOIN platform_access_managers AS current_manager
    ON current_manager.email = lower(o.email)
  WHERE lower(o.email) = 'suporte2@tecfag.com.br'
  ORDER BY (o.tenant_id = current_manager.tenant_id) ASC, o.created_at ASC
  LIMIT 1
)
INSERT INTO platform_access_managers (email, tenant_id)
SELECT 'suporte2@tecfag.com.br', candidate.tenant_id FROM candidate
ON CONFLICT (email) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

UPDATE operators AS o SET role = 'admin'
FROM platform_access_managers AS manager
WHERE lower(o.email) = manager.email
  AND o.tenant_id = manager.tenant_id
  AND manager.email = 'suporte2@tecfag.com.br';
