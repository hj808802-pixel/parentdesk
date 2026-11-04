import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "../globals.css";
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, getDict, isLocale, localePath, type Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/context";
import { FamilyProvider } from "@/lib/family-context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import NavLinks from "@/components/NavLinks";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://parentdesk.vercel.app";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

function resolveLocale(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = getDict(locale);
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [LOCALE_TAGS[l], localePath(l)]));
  languages["x-default"] = "/";
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: `%s · ${t.meta.siteName}` },
    description: t.meta.description,
    applicationName: t.meta.siteName,
    alternates: { canonical: localePath(locale), languages },
    openGraph: {
      type: "website",
      siteName: t.meta.siteName,
      title: t.meta.title,
      description: t.meta.description,
      url: localePath(locale),
      locale: LOCALE_TAGS[locale],
      images: [{ url: "/og.png", width: 1200, height: 630, alt: t.meta.siteName }],
    },
    twitter: { card: "summary_large_image", title: t.meta.title, description: t.meta.description, images: ["/og.png"] },
    robots: { index: true, follow: true },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/favicon.ico" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

// Browser auto-translate replaces text nodes with <font> wrappers, which makes React throw
// on its next update. This guard makes the two DOM calls tolerant. See facebook/react#11538.
const TRANSLATE_GUARD = `(function(){
if(typeof Node!=="function"||!Node.prototype)return;
function up(p,n){while(n&&n.parentNode!==p)n=n.parentNode;return n;}
var rc=Node.prototype.removeChild;
Node.prototype.removeChild=function(c){
if(c&&c.parentNode!==this){var w=up(this,c);if(w&&w.nodeName==="FONT")rc.call(this,w);return c;}
return rc.apply(this,arguments);};
var ib=Node.prototype.insertBefore;
Node.prototype.insertBefore=function(n,r){
if(r&&r.parentNode!==this)return ib.call(this,n,up(this,r)||null);
return ib.apply(this,arguments);};
})();`;

export default async function RootLayout({ children, params }: Props) {
  const locale = resolveLocale((await params).locale);
  const t = getDict(locale);
  return (
    <html lang={LOCALE_TAGS[locale]} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TRANSLATE_GUARD }} />
      </head>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <LocaleProvider locale={locale} dict={t}>
          <FamilyProvider>
            <header className="sticky top-0 z-20 border-b bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
                <Link href={localePath(locale, "/")} className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-tight">
                  <span className="inline-block h-6 w-6 rounded-md bg-indigo-600" aria-hidden />
                  {t.nav.brand} <span className="font-normal text-zinc-500">{t.nav.beta}</span>
                </Link>
                <div className="flex items-center gap-3">
                  <NavLinks className="hidden sm:flex" />
                  <LanguageSwitcher />
                </div>
              </div>
            </header>
            <div className="flex-1">{children}</div>
            <NavLinks className="sticky bottom-0 z-20 flex justify-around border-t bg-white/95 px-2 py-2 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-900/95" mobile />
            <footer className="border-t px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
              <p>{t.nav.footer}</p>
              <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                <Link href={localePath(locale, "/privacy")} className="underline underline-offset-4">
                  {t.nav.privacy}
                </Link>
                <Link href={localePath(locale, "/terms")} className="underline underline-offset-4">
                  {t.nav.terms}
                </Link>
                <a href="https://github.com/hj808802-pixel/parentdesk" className="underline underline-offset-4" rel="noopener">
                  GitHub
                </a>
              </p>
            </footer>
          </FamilyProvider>
        </LocaleProvider>
        <Analytics />
      </body>
    </html>
  );
}
