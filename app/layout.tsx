import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, Azeret_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const mono = Azeret_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Interstellar — Make your ideas orbit",
  description:
    "Describe an app. Watch it come alive — a real, beautifully-designed native Expo app, in seconds.",
  openGraph: {
    title: "Interstellar — Make your ideas orbit",
    description:
      "Describe an app. Watch it come alive — a real, beautifully-designed native Expo app, in seconds.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ConvexClientProvider>
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "rgba(16,18,22,0.96)",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(12px)",
                color: "#F4F2EC",
              },
            }}
          />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
