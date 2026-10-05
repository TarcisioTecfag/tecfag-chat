export function renderErrorPage(tenant?: string): string {
  const isTecfagInitial = tenant === "tecfag";
  const initialTitle = isTecfagInitial ? "Ops! Algo deu errado — Tecfag Chat" : "Ops! Algo deu errado — Valem Chat";
  const initialAvatar = isTecfagInitial ? "/fagner.png" : "/valentina.png";
  const initialBadge = isTecfagInitial ? "Fagner IA" : "Valentina IA";
  const initialTeamsMsg = encodeURIComponent(
    isTecfagInitial
      ? "Olá, Tarcisio! Ocorreu um erro no sistema Tecfag Chat."
      : "Olá, Tarcisio! Ocorreu um erro no sistema Valem Chat."
  );

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title id="vlm-title">${initialTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --brand-color: ${isTecfagInitial ? "#df3d3d" : "#10b981"};
        --brand-hover: ${isTecfagInitial ? "#b91c1c" : "#059669"};
        --brand-border: ${isTecfagInitial ? "rgba(223, 61, 61, 0.4)" : "rgba(16, 185, 129, 0.4)"};
        --brand-soft: ${isTecfagInitial ? "rgba(223, 61, 61, 0.15)" : "rgba(16, 185, 129, 0.15)"};
      }
      body { font-family: system-ui, -apple-system, sans-serif; background: #0b1329; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 24rem; width: 100%; text-align: center; padding: 2rem; background: #162032; border: 1px solid var(--brand-border); border-radius: 1.5rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
      .avatar-wrapper { position: relative; width: 6rem; height: 6rem; margin: 0 auto 1rem; }
      .avatar { width: 6rem; height: 6rem; border-radius: 9999px; object-fit: cover; border: 4px solid var(--brand-border); }
      .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 800; background: var(--brand-soft); color: var(--brand-color); border: 1px solid var(--brand-border); margin-bottom: 0.75rem; }
      h1 { font-size: 1.25rem; font-weight: 900; margin: 0 0 0.5rem; color: #ffffff; }
      p { color: #94a3b8; font-size: 0.875rem; font-weight: 500; margin: 0 0 1.5rem; }
      .actions { display: flex; flex-direction: column; gap: 0.75rem; }
      .btn-primary { background: var(--brand-color); color: #ffffff; padding: 0.875rem 1rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 900; border: none; cursor: pointer; text-decoration: none; transition: background 0.2s; }
      .btn-primary:hover { background: var(--brand-hover); }
      .btn-teams { background: var(--brand-soft); color: var(--brand-color); padding: 0.875rem 1rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 900; border: 1px solid var(--brand-border); cursor: pointer; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background 0.2s; }
      .btn-teams:hover { background: var(--brand-border); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="avatar-wrapper">
        <img id="ai-avatar" src="${initialAvatar}" alt="${initialBadge}" class="avatar" />
      </div>
      <span id="ai-badge" class="badge">${initialBadge}</span>
      <h1>Ops, acho que algo deu errado! 🤖</h1>
      <p>Poderia avisar o Tarcisio por favor?</p>
      <div class="actions">
        <button class="btn-primary" onclick="location.reload()">Tentar de novo</button>
        <a id="btn-teams" class="btn-teams" href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=${initialTeamsMsg}" target="_blank" rel="noopener noreferrer">Falar com Tarcisio (Teams)</a>
      </div>
    </div>
    <script>
      (function() {
        try {
          var t = localStorage.getItem("chat_tenant");
          if (t === "tecfag") {
            document.title = "Ops! Algo deu errado — Tecfag Chat";
            var root = document.documentElement;
            root.style.setProperty("--brand-color", "#df3d3d");
            root.style.setProperty("--brand-hover", "#b91c1c");
            root.style.setProperty("--brand-border", "rgba(223, 61, 61, 0.4)");
            root.style.setProperty("--brand-soft", "rgba(223, 61, 61, 0.15)");
            var img = document.getElementById("ai-avatar");
            if (img) { img.src = "/fagner.png"; img.alt = "Fagner IA"; }
            var b = document.getElementById("ai-badge");
            if (b) { b.textContent = "Fagner IA"; }
            var teams = document.getElementById("btn-teams");
            if (teams) {
              teams.href = "https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=" + encodeURIComponent("Olá, Tarcisio! Ocorreu um erro no sistema Tecfag Chat.");
            }
          }
        } catch(e) {}
      })();
    </script>
  </body>
</html>`;
}
