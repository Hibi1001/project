/* eslint-disable no-undef */
/**
 * Background FCM only. Foreground messages are handled in the app via `onMessage` (toast).
 * Server sends data-only payloads (title/body in `data`) so the browser does not auto-show
 * a notification in addition to `showNotification` here (duplicate banners).
 */
// Keep in sync with `firebase` in package.json (avoids messaging version skew).
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

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

// Only show a system notification when no app tab has focus — otherwise the page
// handles the same message via `onMessage` (toast) and a banner here would duplicate.
messaging.onBackgroundMessage(async (payload) => {
  console.log('[firebase-messaging-sw.js] FCM message in SW:', payload);

  try {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const anyFocused = allClients.some(
      (c) => c.focused === true && c.visibilityState === 'visible',
    );
    if (anyFocused) {
      console.log(
        '[firebase-messaging-sw.js] skip system notification (focused client → onMessage / toast)',
      );
      return;
    }
  } catch (e) {
    console.warn('[firebase-messaging-sw.js] clients.matchAll failed', e);
  }

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
    tag: payload.messageId || 'mysession-fcm',
    renotify: false,
  };

  await self.registration.showNotification(notificationTitle, options);
});
