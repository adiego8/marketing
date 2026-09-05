"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

interface AuthUser {
  email: string;
  agencyId: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  firebaseUser: User | null;
  loading: boolean;
  /** Set when Firebase authenticated the person but they have no marketing access. */
  accessError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  firebaseUser: null,
  loading: true,
  accessError: null,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // onIdTokenChanged (not onAuthStateChanged) so a token refresh re-syncs the
  // session, not just sign-in and sign-out.
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    return onIdTokenChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        // Resolves marketing membership; a valid Firebase account is not
        // sufficient, since this project is shared with the other numerico apps.
        const res = await fetch("/api/v1/auth/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${await fbUser.getIdToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser({
            email: data.user_email,
            agencyId: data.agency_id,
            role: data.role,
          });
          setAccessError(null);
        } else {
          const body = await res.json().catch(() => ({}));
          setUser(null);
          setAccessError(body.error || "You do not have access to this app.");
        }
      } catch {
        setUser(null);
        setAccessError("Could not verify your session.");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!loading && !user && pathname !== "/login") {
      router.replace("/login");
    }
  }, [loading, user, pathname, router]);

  const signIn = async () => {
    if (!auth) return;
    setAccessError(null);
    await signInWithPopup(auth, new GoogleAuthProvider());
  };

  const signOut = async () => {
    if (auth) await firebaseSignOut(auth);
    setUser(null);
    router.replace("/login");
  };

  // Gate children on the auth check. Rendering them earlier let every page fire
  // its own API calls in parallel with the check, racing the redirect and
  // producing spurious 401s on load.
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{ user, firebaseUser, loading, accessError, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
