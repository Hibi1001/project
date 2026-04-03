/* eslint-disable no-undef */
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
  const n = payload.notification;
  const notificationTitle = n?.title ?? '通知';
  const notificationOptions = {
    body: n?.body ?? '',
    icon: '/favicon.svg',
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
