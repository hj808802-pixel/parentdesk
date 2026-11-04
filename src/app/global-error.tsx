"use client";

// Replaces the root layout when it fails to render. No provider above it, so English only.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1rem", textAlign: "center", color: "#18181b" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Something went wrong</h1>
        <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#52525b" }}>
          Please reload the page. If your browser translates this site automatically and the problem repeats, turn translation off for this site.
        </p>
        <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "0.5rem" }}>
          <button type="button" onClick={() => reset()} style={{ borderRadius: 9999, background: "#4f46e5", color: "#fff", padding: "0.6rem 1.25rem", border: 0, fontWeight: 600 }}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} style={{ borderRadius: 9999, background: "#fff", color: "#18181b", padding: "0.6rem 1.25rem", border: "1px solid #d4d4d8" }}>
            Reload
          </button>
        </div>
        {error.digest && <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#a1a1aa" }}>Error {error.digest}</p>}
      </body>
    </html>
  );
}
