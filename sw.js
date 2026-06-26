self.addEventListener('install', (e) => { self.skipWaiting(); });

// 🔥 알림 수신 시 화면에 팝업을 띄우는 로직
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { title: '친구 코인', body: '새로운 알림이 도착했습니다!' };
    const options = {
        body: data.body,
        icon: 'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4',
        vibrate: [200, 100, 200],
        data: { url: '/' }
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
});

// 🔥 유저가 알림을 클릭하면 앱 화면으로 이동하는 로직
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url));
});