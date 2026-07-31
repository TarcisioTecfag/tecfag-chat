// Service Worker para Web Push Notifications - Tecfag & Valem Chat

self.addEventListener("push", function (event) {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || "Nova Mensagem";
    const conversationId = payload.conversationId;

    const options = {
      body: payload.body || "Você tem uma nova mensagem de atendimento.",
      icon: payload.icon || (payload.tenantId === "valem" ? "/logo_valem.jpg" : "/logo_tecfag.png"),
      badge: "/favicon.png",
      tag: conversationId ? "chat-" + conversationId : "general-push",
      renotify: true,
      data: {
        conversationId: conversationId,
        url: payload.url || (conversationId ? "/?chatId=" + conversationId : "/"),
        tenantId: payload.tenantId,
      },
      vibrate: [100, 50, 100],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error("Erro ao processar evento de Push no Service Worker:", err);
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
