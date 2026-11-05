import Anthropic from "@anthropic-ai/sdk";
import { ExtractError } from "./extract";

// Maps a failure in a model call to the JSON error the client expects.
export function modelErrorResponse(e: unknown, tag: string, requestId?: string): Response {
  const fail = (code: string, status: number) => Response.json({ ok: false, error: code, request_id: requestId }, { status });
  if (e instanceof ExtractError) {
    console.warn(`[${tag}]`, requestId ?? "", e.code, e.message);
    return fail(e.code, 422);
  }
  if (e instanceof Anthropic.AuthenticationError) {
    console.error(`[${tag}] authentication failed: check ANTHROPIC_API_KEY`);
    return fail("server_not_configured", 500);
  }
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError) {
    console.error(`[${tag}] upstream unavailable`, e.message);
    return fail("upstream_unavailable", 503);
  }
  if (e instanceof Anthropic.APIError) {
    console.error(`[${tag}] upstream error`, e.status, e.message);
    return fail("upstream_error", 502);
  }
  console.error(`[${tag}] unexpected`, e);
  return fail("internal", 500);
}
