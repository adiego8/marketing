import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Never throws at import time — if the env vars are absent, adminAuth/adminDb
// stay undefined so the app still builds and renders. The throw is deferred to
// the db() accessor in lib/firestore.ts, which surfaces misconfig at the point
// of use instead of silently no-opping.
//
// This app uses its own Firebase project, separate from numerico-website: the
// `users` and `google_credentials` collections would otherwise collide, making
// every website admin a marketing admin.

let adminAuth: Auth | undefined;
let adminDb: Firestore | undefined;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }
  adminAuth = getAuth();
  adminDb = getFirestore();
}

export { adminAuth, adminDb };
