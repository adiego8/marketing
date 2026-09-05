"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { getAuthMe } from "./api";

interface AuthUser {
  email: string;
  agencyId: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    getAuthMe()
      .then((data) => {
        if (data.google_connected && data.user_email) {
          setUser({ email: data.user_email, agencyId: data.agency_id });
        } else if (pathname !== "/login") {
          router.replace("/login");
        }
      })
      .catch(() => {
        if (pathname !== "/login") {
          router.replace("/login");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => {
    fetch("/api/v1/auth/signout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        setUser(null);
        window.location.href = "/login";
      });
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
