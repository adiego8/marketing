"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

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
    <div className="flex items-center justify-center min-h-screen bg-zinc-50">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Marketing Agent</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Sign in to manage your clients
            </p>
          </div>
          {(error || accessError) && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {error || accessError}
            </p>
          )}
          <Button onClick={handleSignIn} className="w-full" disabled={signingIn}>
            {signingIn ? "Signing in..." : "Sign in with Google"}
          </Button>
          <p className="text-xs text-zinc-400">
            Google Calendar can be connected later, from Settings
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
