import { useEffect, useState } from "react";
import { Masthead } from "../components/masthead";
import { Row } from "../components/story";
import { cloudflare } from "../context";
import { siteCounts } from "../lib/compose.server";
import { readSaved, removeSaved } from "../lib/saved";
import type { Story } from "../lib/sections";
import type { Route } from "./+types/saved";

export function meta() {
  return [{ title: "Saved — Tech News Agent" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  return { counts: await siteCounts(context.get(cloudflare).env) };
}

/**
 * The saved list lives in the reader's browser, not on the server.
 *
 * No account, no cookie, nothing about what anyone reads stored anywhere we
 * control. The cost is that the list does not follow you between devices,
 * which is a fair trade for a portal that never asks who you are.
 */
export default function Saved({ loaderData }: Route.ComponentProps) {
  const [stories, setStories] = useState<Story[] | null>(null);

  useEffect(() => {
    const ids = readSaved();
    if (ids.length === 0) {
      setStories([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/stories.json?ids=${ids.join(",")}`)
      .then((r) => r.json() as Promise<{ stories: Story[] }>)
      .then((d) => {
        if (!cancelled) setStories(d.stories);
      })
      .catch(() => {
        if (!cancelled) setStories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const drop = (id: number) => {
    removeSaved(id);
    setStories((current) => (current ?? []).filter((s) => s.id !== id));
  };

  return (
    <>
      <Masthead counts={loaderData.counts} current="saved" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            Saved
          </h1>
          <span className="meta">
            KEPT IN THIS BROWSER ONLY · NO ACCOUNT, NOTHING STORED ON THE SERVER
          </span>
        </div>
        <div className="rule-heavy" />

        {stories === null ? (
          <p style={{ padding: "40px 0", color: "var(--ink-3)" }}>Loading…</p>
        ) : stories.length === 0 ? (
          <p style={{ padding: "40px 0", color: "var(--ink-3)", maxWidth: "62ch" }}>
            Nothing saved yet. Open a story and choose <strong>Save</strong> to keep it here. The
            list stays in this browser, so clearing site data clears it.
          </p>
        ) : (
          stories.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Row story={s} thumb />
              </div>
              <button
                type="button"
                onClick={() => drop(s.id)}
                className="meta"
                style={{
                  marginTop: 14,
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: 3,
                  padding: "4px 8px",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                REMOVE
              </button>
            </div>
          ))
        )}
      </main>
    </>
  );
}
