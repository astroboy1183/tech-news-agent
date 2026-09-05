import { cloudflare } from "../context";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Tech News Agent" },
    { name: "description", content: "A one-stop portal for everything technology." },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sources WHERE active = 1").first<{
    n: number;
  }>();
  return { sources: row?.n ?? 0 };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "72px 24px" }}>
      <h1
        className="ser"
        style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}
      >
        Tech News Agent
      </h1>
      <p style={{ color: "var(--ink-2)", marginTop: 12 }}>
        Scaffold is live. {loaderData.sources} sources seeded and polling begins at v0.2.0.
      </p>
      <p className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 28 }}>
        v0.1.0 · FOUNDATION
      </p>
    </main>
  );
}
