import "./globals.css";
import type { ReactNode } from "react";
import { Outfit } from "next/font/google";
import { StoreProvider } from "@/lib/store";
import { NavTabs } from "@/components/NavTabs";

const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-sans" });

export const metadata = { title: "GotCha", description: "Live interview co-pilot for recruiters" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="font-light">
        <StoreProvider>
          <NavTabs />
          <main className="px-8 pb-8">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
