// Firebase connection. The values come from mobile/.env (see .env.example).
// A Firebase web config is an identifier, not a secret: access is controlled
// by sign-in plus the database rules in firebase/database.rules.json.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { Platform } from 'react-native';

// Present in the React Native build of firebase/auth, but missing from the
// package's default type definitions.
const getReactNativePersistence = (
  firebaseAuth as unknown as { getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence }
).getReactNativePersistence;

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.databaseURL && config.projectId);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Database | undefined;

if (firebaseConfigured) {
  const fresh = getApps().length === 0;
  app = fresh ? initializeApp(config) : getApps()[0];
  if (Platform.OS === 'web' || !fresh || !getReactNativePersistence) {
    auth = getAuth(app);
  } else {
    // Keep the owner signed in between launches on Android and iOS.
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  }
  db = getDatabase(app);
}

export function fb(): { auth: Auth; db: Database } {
  if (!auth || !db) throw new Error('Firebase is not configured');
  return { auth, db };
}
