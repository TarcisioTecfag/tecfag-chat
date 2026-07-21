export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Ops! Algo deu errado — Valem Chat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0b1329; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 24rem; width: 100%; text-align: center; padding: 2rem; background: #162032; border: 1px solid #10b98133; border-radius: 1.5rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
      .avatar-wrapper { position: relative; width: 6rem; height: 6rem; margin: 0 auto 1rem; }
      .avatar { width: 6rem; height: 6rem; border-radius: 9999px; object-fit: cover; border: 4px solid rgba(16, 185, 129, 0.4); }
      .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 800; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); margin-bottom: 0.75rem; }
      h1 { font-size: 1.25rem; font-weight: 900; margin: 0 0 0.5rem; color: #ffffff; }
      p { color: #94a3b8; font-size: 0.875rem; font-weight: 500; margin: 0 0 1.5rem; }
      .actions { display: flex; flex-direction: column; gap: 0.75rem; }
      .btn-primary { background: #10b981; color: #ffffff; padding: 0.875rem 1rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 900; border: none; cursor: pointer; text-decoration: none; transition: background 0.2s; }
      .btn-primary:hover { background: #059669; }
      .btn-teams { background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 0.875rem 1rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 900; border: 1px solid rgba(16, 185, 129, 0.3); cursor: pointer; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background 0.2s; }
      .btn-teams:hover { background: rgba(16, 185, 129, 0.25); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="avatar-wrapper">
        <img src="/valentina.png" alt="Valentina IA" class="avatar" />
      </div>
      <span class="badge">Valentina IA</span>
      <h1>Ops, acho que algo deu errado! 🤖</h1>
      <p>Poderia avisar o Tarcisio por favor?</p>
      <div class="actions">
        <button class="btn-primary" onclick="location.reload()">Tentar de novo</button>
        <a class="btn-teams" href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=Olá,%20Tarcisio!%20Ocorreu%20um%20erro%20no%20sistema%20Valem%20Chat." target="_blank" rel="noopener noreferrer">Falar com Tarcisio (Teams)</a>
      </div>
    </div>
  </body>
</html>`;
}
