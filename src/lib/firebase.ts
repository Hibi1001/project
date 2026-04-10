import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging';

const firebaseConfig = {
  apiKey: 'AIzaSyBRyLnyFGIDOYNkE8CJJAAr3HCOCT31XpE',
  authDomain: 'hibiki-music-app-mysession.firebaseapp.com',
  projectId: 'hibiki-music-app-mysession',
  storageBucket: 'hibiki-music-app-mysession.firebasestorage.app',
  messagingSenderId: '718365768164',
  appId: '1:718365768164:web:61c8edcfedb35ac79faff1',
};

const VAPID_KEY =
  'BIqJ6ZMT9CRIO0C8lk4IBJT2WucTXp8zyP3kTTT5sHDQKBTdoANpYvep3UUql21Fo-pI64G6Db79i-mKvV7aL4U';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Lazy `getMessaging` so unsupported / restricted WebViews (e.g. LINE in-app) never throw
 * at module load — that would blank-screen the whole app before React mounts.
 */
let messagingInstance: Messaging | null | undefined;

function getMessagingLazy(): Messaging | null {
  if (typeof window === 'undefined') return null;
  if (messagingInstance === null) return null;
  if (messagingInstance !== undefined) return messagingInstance;
  try {
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (e) {
    console.warn('[firebase] getMessaging failed (environment may not support FCM):', e);
    messagingInstance = null;
    return null;
  }
}

export async function isForegroundMessagingAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * フォアグラウンド専用。`new Notification()` は使わず、コールバックで UI（トースト等）に渡す。
 * バックグラウンド表示は Service Worker の onBackgroundMessage のみ。
 */
export function subscribeForegroundFcmMessages(
  handler: (payload: { title: string; body: string; messageId?: string }) => void,
): () => void {
  const messaging = getMessagingLazy();
  if (!messaging) {
    return () => {};
  }
  return onMessage(messaging, (payload: MessagePayload) => {
    const d = payload.data;
    const title =
      (typeof d?.title === 'string' && d.title.trim()) ||
      payload.notification?.title?.trim() ||
      'マイセッション';
    const rawBody =
      (typeof d?.body === 'string' && d.body.trim()) ||
      payload.notification?.body?.trim() ||
      '';
    const body = rawBody || 'タップして詳細を表示';
    handler({
      title: title || 'マイセッション',
      body,
      messageId: payload.messageId,
    });
  });
}

/**
 * 通知の許可を得て FCM トークンを取得する。
 * `/firebase-messaging-sw.js` をルートに置き、この関数内で登録してから getToken する。
 */
export async function requestForToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    if (!(await isSupported())) {
      console.log('この環境では Firebase Messaging が利用できません。');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('通知の許可が得られませんでした。');
      return null;
    }

    if (!('serviceWorker' in navigator)) {
      console.log('Service Worker が利用できません。');
      return null;
    }

    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
    );
    await navigator.serviceWorker.ready;

    const messaging = getMessagingLazy();
    if (!messaging) {
      return null;
    }

    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (currentToken) {
      console.log('FCMトークンを取得しました:', currentToken);
      return currentToken;
    }

    console.log('トークンの取得に失敗しました。');
    return null;
  } catch (err) {
    console.error('トークン取得中にエラーが発生しました:', err);
    return null;
  }
}
