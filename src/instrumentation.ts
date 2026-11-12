// Runs once when the server starts (not once per route or per reload).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Development files are not a shared store: a restarted dev server starts counting
  // afresh, as it always did. The shared store is never emptied from here.
  const { wipeMarks } = await import("@/lib/store");
  wipeMarks();
}
