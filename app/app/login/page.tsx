"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-zinc-500">Loading...</p>
    </div>
  );
}

// useSearchParams() opts a component into client-side rendering, so it must sit
// inside a Suspense boundary or the static prerender of /login fails at build.
function LoginContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (user) return null;

  const handleSignIn = () => {
    window.location.href = "/api/v1/auth/signin";
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
          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
          )}
          <Button onClick={handleSignIn} className="w-full">
            Sign in with Google
          </Button>
          <p className="text-xs text-zinc-400">
            Calendar permissions will be requested for scheduling
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginContent />
    </Suspense>
  );
}
