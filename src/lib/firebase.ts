import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

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

/** クライアント専用。このモジュールはブラウザからのみ import すること。 */
export const messaging = getMessaging(app);

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
