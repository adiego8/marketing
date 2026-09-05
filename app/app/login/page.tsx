"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { NumericoMark } from "@/components/brand/numerico-mark";
import { banner, btn, surface } from "@/lib/ui";

export default function LoginPage() {
  const { user, loading, accessError, signIn } = useAuth();
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (user) return null;

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sign-in failed";
      // A popup the user dismissed is not worth showing as an error.
      setError(message.includes("popup-closed-by-user") ? null : message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-stone-50 px-4">
      <div className={`w-full max-w-sm ${surface.card} p-8 text-center`}>
        <NumericoMark className="h-12 w-12 mx-auto mb-5" />

        <h1 className="text-2xl text-slate-900">
          <span className="font-mono">Numerico</span> Marketing
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Sign in to plan and schedule client content.
        </p>

        {(error || accessError) && (
          <p className={`${banner.error} mt-6 text-left`}>
            {error || accessError}
          </p>
        )}

        <button
          onClick={handleSignIn}
          className={`${btn.primary} w-full mt-6`}
          disabled={signingIn}
        >
          {signingIn ? "Signing in…" : "Sign in with Google"}
        </button>

        <p className="text-xs text-slate-400 mt-5">
          Google Calendar can be connected later, from Settings.
        </p>
      </div>
    </div>
  );
}
