import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";

// Browser-side Firebase, used only to obtain an ID token that API routes verify
// with the Admin SDK. Mirrors numerico-website/lib/firebase.ts: guarded on
// apiKey so the app still builds without config, and getApps() reused across
// hot reloads.
//
// This app shares the `numerico-app` Firebase project with the other numerico
// apps, so sign-in is shared. Marketing *authorisation* is separate — see
// lib/auth.ts.

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

if (firebaseConfig.apiKey) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

  if (typeof window !== "undefined") {
    try {
      auth = initializeAuth(app, {
        persistence: browserLocalPersistence,
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      // Already initialized (hot reload)
      auth = getAuth(app);
    }
  } else {
    auth = getAuth(app);
  }
}

export { auth };
