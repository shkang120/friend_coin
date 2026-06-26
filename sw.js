self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // PWA 앱 설치 기준을 충족하기 위한 기본 네트워크 패스스루 로직
});