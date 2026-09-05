import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;0,7..72,700;1,7..72,400&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        <Links />
        {/* Applied before first paint: without it the page renders in Paper,
            then repaints into Ink a frame later, which reads as a flicker on
            every navigation. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: must run before paint
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='ink'||t==='paper')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
