import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter, Inconsolata } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { ConfirmProvider } from "@/components/ui/confirm-provider";
import "./globals.css";

// The Numerico type stack, matching numerico-website: Plus Jakarta Sans for
// headings (700/800 only — the weight comes from the face, not a class), Inter
// for body, Inconsolata for mono and the wordmark.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["700", "800"],
});

// 600 is loaded because the app asks for it in 36 places — every btn.* token,
// toggle(), the status pills, tabs, and text.cardTitle, which is the section
// heading on nearly every screen. Without the file, the browser smeared 500
// into a fake 600, which is what made a `font-semibold` row look a size larger
// than its neighbours. globals.css turns weight synthesis off so a missing
// weight fails visibly rather than quietly.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const inconsolata = Inconsolata({
  variable: "--font-inconsolata",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Numerico Marketing",
  description: "Plan and schedule client content.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${inter.variable} ${inconsolata.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-stone-50 text-slate-800">
        <AuthProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
