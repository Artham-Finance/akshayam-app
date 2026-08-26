import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Group Management Reporting",
  description: "Monthly financial statements, revenue, receivables and collections.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The entity name is read at render time, but a missing database should not
  // blank the whole app - the setup page needs to stay reachable.
  let entityName = "Management Reporting";
  let entities: { slug: string; name: string }[] = [];
  let currentSlug = "";
  try {
    const { getEntity, listEntities } = await import("@/lib/entity");
    const [entity, all] = await Promise.all([getEntity(), listEntities()]);
    entityName = entity.name;
    currentSlug = entity.slug;
    entities = all.map((e) => ({ slug: e.slug, name: e.name }));
  } catch {
    // Database not reachable yet - the setup screen still needs to render.
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <Nav entityName={entityName} entities={entities} currentSlug={currentSlug} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
        <footer className="no-print border-t border-line px-4 py-4 text-[11px] text-ink-faint sm:px-6">
          <div className="mx-auto max-w-[1400px]">
            Figures are in Indian rupees unless stated otherwise. Prepared from the
            client&rsquo;s Zoho Books records.
          </div>
        </footer>
      </body>
    </html>
  );
}
