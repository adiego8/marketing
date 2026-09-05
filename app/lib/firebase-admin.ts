import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Never throws at import time — if the env vars are absent, adminAuth/adminDb
// stay undefined so the app still builds and renders. The throw is deferred to
// the db() accessor in lib/firestore.ts, which surfaces misconfig at the point
// of use instead of silently no-opping.
//
// SHARED FIREBASE PROJECT, SEPARATE DATA.
//
// This app runs in the SAME Firebase project as numerico-website, because
// Firebase Auth is project-scoped: a second project would mean a second account
// for the same person, and this product is sold through numerico, where the
// customer already signs in. Authorisation is still marketing-specific — see
// lib/auth.ts.
//
// Its own data lives in a separate Firestore database when FIREBASE_DATABASE_ID
// is set, which buys separate security rules and separate backups without
// splitting identity. Unset, it falls back to (default); the marketing_*
// collection prefixes keep it distinct either way, so a first run is not
// blocked on that database existing.

let adminAuth: Auth | undefined;
let adminDb: Firestore | undefined;
/** Always (default): where numerico-website keeps customers and entitlements. */
let numericoDb: Firestore | undefined;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  const app =
    getApps().length === 0
      ? initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          }),
        })
      : getApps()[0];

  adminAuth = getAuth(app);

  const databaseId = process.env.FIREBASE_DATABASE_ID;
  adminDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  numericoDb = databaseId ? getFirestore(app) : adminDb;

  // The Admin SDK throws on an undefined field value, which turns one missed
  // optional into a failed save. Optional fields here are written as explicit
  // null; this is the seatbelt for any that slip through.
  //
  // settings() is only legal before the instance is first used and only once,
  // so both re-entry (hot reload, dev-mode double invocation) and a late call
  // throw. Neither is fatal — the default behaviour is simply stricter.
  for (const instance of new Set([adminDb, numericoDb])) {
    try {
      instance.settings({ ignoreUndefinedProperties: true });
    } catch {
      // already configured or already in use
    }
  }
}

export { adminAuth, adminDb, numericoDb };
