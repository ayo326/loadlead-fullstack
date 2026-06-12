// LoadLead Service Worker — handles Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'LoadLead', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LoadLead', {
      body: data.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || 'https://loadleadapp.com' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://loadleadapp.com';
  event.waitUntil(clients.openWindow(url));
});
