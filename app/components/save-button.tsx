import { useEffect, useState } from "react";
import { isSaved, toggleSaved } from "../lib/saved";

/**
 * Starts in an unknown state on purpose.
 *
 * The server has no idea what this reader saved — the list is in their browser
 * — so rendering "Save" or "Saved" before hydration would be a guess that
 * flips a moment later. It renders neutral until the client knows.
 */
export function SaveButton({ storyId }: { storyId: number }) {
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    setSaved(isSaved(storyId));
  }, [storyId]);

  return (
    <button
      type="button"
      onClick={() => setSaved(toggleSaved(storyId))}
      aria-pressed={saved ?? false}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        borderRadius: 4,
        border: `1px solid ${saved ? "var(--accent)" : "var(--rule)"}`,
        background: "var(--card)",
        color: saved ? "var(--accent)" : "var(--ink-2)",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <title>{saved ? "Saved" : "Save"}</title>
        <path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z" />
      </svg>
      {saved === null ? "Save" : saved ? "Saved" : "Save"}
    </button>
  );
}
