export interface User {
  id: string;
  /** Public handle (stored lowercase in DB); null until set. */
  displayId: string | null;
  name: string;
  avatar: string;
  instruments: string[];
  genres: string[];
  topBands: string[];
  gear: string[];
  recruitment: string;
}

export interface Post {
  id: string;
  userId: string;
  songTitle: string;
  artist: string;
  albumArt: string;
  previewUrl?: string;
  reactions: {
    vocal: number;
    guitar: number;
    bass: number;
    drum: number;
    keyboard: number;
  };
}

export type InstrumentType = 'vocal' | 'guitar' | 'bass' | 'drum' | 'keyboard';

// Database table models (Supabase)

export interface DbUser {
  id: string;
  /** Synced from auth at signup when the column exists; optional per schema. */
  email?: string | null;
  display_id: string | null;
  display_name: string;
  avatar_url: string | null;
  played_instruments: string[] | null;
  favorite_genres: string[] | null;
  top_3_bands: string[] | null;
  my_gear: string[] | null;
  recruitment_status: string | null;
}

export interface DbPost {
  id: string;
  user_id: string;
  song_title: string;
  artist_name: string;
  preview_url: string;
  cover_url?: string | null;
  created_at: string;
}

export interface DbReaction {
  id: string;
  post_id: string;
  user_id: string;
  instrument_type: InstrumentType;
}

