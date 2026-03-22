import { User, Post } from './types';

export const users: User[] = [
  {
    id: 'user1',
    displayId: null,
    name: 'Ken',
    avatar: 'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=400',
    instruments: ['Bass'],
    genres: ['Neo Soul', 'Acid Jazz'],
    topBands: ['Suchmos', 'Jamiroquai', 'Vulfpeck'],
    gear: ['Fender Jazz Bass', 'ZOOM B3n (Multi-effects)'],
    recruitment: 'グルーヴ感のあるオリジナル曲を作りたいです！タイトなビートを叩けるドラム募集中！',
  },
  {
    id: 'user2',
    displayId: null,
    name: 'Sho',
    avatar: 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=400',
    instruments: ['Guitar'],
    genres: ['Math Rock', 'Emo'],
    topBands: ['American Football', 'toe', 'CHON'],
    gear: ['Fender Telecaster', 'Strymon Timeline (Delay pedal)'],
    recruitment: '変則チューニングでポストロック系のセッションしませんか？ベースとドラム募集！',
  },
];

export const posts: Post[] = [
  {
    id: 'post1',
    userId: 'user1',
    songTitle: 'STAY TUNE',
    artist: 'Suchmos',
    albumArt: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600',
    reactions: {
      vocal: 3,
      guitar: 5,
      bass: 12,
      drum: 8,
      keyboard: 4,
    },
  },
  {
    id: 'post2',
    userId: 'user2',
    songTitle: 'Never Meant',
    artist: 'American Football',
    albumArt: 'https://images.pexels.com/photos/1699161/pexels-photo-1699161.jpeg?auto=compress&cs=tinysrgb&w=600',
    reactions: {
      vocal: 2,
      guitar: 15,
      bass: 7,
      drum: 9,
      keyboard: 3,
    },
  },
];

export const getUserById = (userId: string): User | undefined => {
  return users.find((user) => user.id === userId);
};
