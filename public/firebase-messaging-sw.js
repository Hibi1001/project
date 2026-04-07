/* eslint-disable no-undef */
/**
 * Background FCM only. Foreground messages are handled in the app via `onMessage` (toast).
 * Server sends data-only payloads (title/body in `data`) so the browser does not auto-show
 * a second system notification alongside `showNotification` here.
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

function absoluteIconUrl(raw) {
  const origin = self.location.origin;
  const fallback = `${origin}/favicon.svg`;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const t = raw.trim();
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  try {
    return new URL(t.startsWith('/') ? t : `/${t}`, origin).href;
  } catch (_e) {
    return fallback;
  }
}

// Focus an open app tab instead of showing a duplicate banner while the user is in the app.
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

  const notificationTitle = String(
    (typeof d.title === 'string' && d.title.trim()) ||
      (n && n.title) ||
      'マイセッション',
  ).trim() || 'マイセッション';

  let notificationBody = String(
    (typeof d.body === 'string' && d.body.trim()) ||
      (n && n.body) ||
      '',
  ).trim();
  if (!notificationBody) {
    notificationBody = 'タップしてアプリを開く';
  }

  const iconUrl = absoluteIconUrl(d.icon_url || d.icon);
  const clickPath =
    typeof d.click_action === 'string' && d.click_action.trim()
      ? d.click_action.trim()
      : '/';
  let openUrl;
  try {
    openUrl = new URL(clickPath.startsWith('/') ? clickPath : `/${clickPath}`, self.location.origin).href;
  } catch (_e) {
    openUrl = `${self.location.origin}/`;
  }

  const tag =
    (typeof d.kind === 'string' && d.kind.trim() && payload.messageId
      ? `${d.kind.trim()}-${payload.messageId}`
      : null) || payload.messageId || 'mysession-fcm';

  const options = {
    body: notificationBody,
    icon: iconUrl,
    badge: iconUrl,
    tag,
    renotify: false,
    silent: false,
    data: {
      click_action: clickPath,
      open_url: openUrl,
      ...(typeof d.post_id === 'string' ? { post_id: d.post_id } : {}),
      ...(typeof d.reply_id === 'string' ? { reply_id: d.reply_id } : {}),
      ...(typeof d.kind === 'string' ? { kind: d.kind } : {}),
    },
  };

  await self.registration.showNotification(notificationTitle, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const raw =
    (typeof data.open_url === 'string' && data.open_url) ||
    (typeof data.click_action === 'string' && data.click_action) ||
    '/';
  let targetUrl;
  try {
    targetUrl = raw.startsWith('http')
      ? raw
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, self.location.origin).href;
  } catch (_e) {
    targetUrl = `${self.location.origin}/`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const c = clientList[i];
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
