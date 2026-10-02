import { NextResponse, type NextRequest } from "next/server";
import {
  CSP_HEADER,
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/securityHeaders";

/**
 * Per-request CSP nonce (#1540).
 *
 * A CSP that omits `'unsafe-inline'` only works if every inline script the app
 * emits carries the same nonce as the response header. `next.config.ts` cannot
 * do this: its `headers()` hook is static, so the value would be the same on
 * every response and therefore readable by an attacker, which defeats the
 * point of a nonce.
 *
 * The documented mechanism is used here:
 *
 *  1. Mint a fresh nonce for this request.
 *  2. Build the policy and set it on the *request* headers. Next.js parses the
 *     nonce out of this request header and stamps it onto the scripts it
 *     injects during rendering.
 *  3. Set the same policy on the *response* so the browser enforces it.
 *
 * The root layout reads the nonce back out of the request headers to nonce the
 * one inline script the app ships itself (the theme bootstrap), so this has to
 * run before rendering. When it does not run - for example a static export -
 * the policy simply is not sent rather than being sent with a broken nonce.
 */
export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy(nonce);

  // Next.js reads the nonce from the request header; the browser reads the
  // response header. Both have to carry the identical value.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_HEADER, policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(CSP_HEADER, policy);

  return response;
}

export const config = {
  /**
   * Skip prefetches and the static assets that never execute script, so the
   * per-request crypto cost is only paid for documents and data requests.
   */
  matcher: [
    /*
     * Everything except:
     *  - `_next/static` (build output, hashed and immutable)
     *  - `_next/image` (the image optimizer)
     *  - `favicon.ico` and common static files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
