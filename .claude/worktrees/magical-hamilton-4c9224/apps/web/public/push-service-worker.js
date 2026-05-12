// Service Worker for Web Push notifications
// Registered explicitly via usePushSubscription when user enables push in Settings.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Notification', message: event.data.text() };
  }

  const title = payload.title || 'Notification';
  const options = {
    body: payload.message,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: payload.id || payload.type,
    data: {
      link: payload.link,
      id: payload.id,
      type: payload.type,
    },
    requireInteraction: payload.severity === 'critical',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = event.notification.data?.link;
  if (!link) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    })
  );
});
