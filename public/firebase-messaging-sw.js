/* eslint-disable no-undef */
/**
 * Background FCM only. Foreground messages are handled in the app via `onMessage` (toast).
 * Server sends data-only payloads (title/body in `data`) so the browser does not auto-show
 * a notification in addition to `showNotification` here (duplicate banners).
 */
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: 'AIzaSyBRyLnyFGIDOYNkE8CJJAAr3HCOCT31XpE',
  authDomain: 'hibiki-music-app-mysession.firebaseapp.com',
  projectId: 'hibiki-music-app-mysession',
  storageBucket: 'hibiki-music-app-mysession.firebasestorage.app',
  messagingSenderId: '718365768164',
  appId: '1:718365768164:web:61c8edcfedb35ac79faff1',
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] 背景で通知を受信:', payload);

  const d = payload.data || {};
  const n = payload.notification;

  const notificationTitle =
    (typeof d.title === 'string' && d.title.trim()) ||
    (n && n.title) ||
    '通知';
  const notificationBody =
    (typeof d.body === 'string' && d.body) ||
    (n && n.body) ||
    '';

  const options = {
    body: notificationBody,
    icon: '/favicon.svg',
    // Same FCM message redelivered → replace one banner instead of stacking duplicates
    tag: payload.messageId || 'mysession-fcm',
    renotify: false,
  };

  return self.registration.showNotification(notificationTitle, options);
});
