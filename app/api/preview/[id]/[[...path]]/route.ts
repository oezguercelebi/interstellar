import { NextRequest } from "next/server";
import { buildJsCacheKey } from "../../../../../lib/jsCacheKey";

/**
 * Same-origin preview proxy — removes Daytona's "I Understand, Continue" warning.
 *
 * Daytona gates the first browser navigation to a preview URL behind a
 * `daytona-preview-page-accepted` cookie set on the sandbox subdomain. Every
 * reopen is a NEW subdomain, and inside our iframe that cookie is a cross-site
 * (third-party) cookie — blocked by default — so the warning reappears every
 * single time and can never stick.
 *
 * We fetch the sandbox server-side WITH the documented skip header
 * (`X-Daytona-Skip-Preview-Warning: true`) and serve it from our own origin at
 * `/api/preview/<id>/…`. The document, JS bundle, chunks, fonts, and images all
 * flow back through this route, so the whole preview is first-party: no warning,
 * and the iframe is same-origin (clean screenshots, no CORS taint).
 *
 * expo-router routes off `location.pathname`, so a head shim resets the iframe
 * path to "/" before the bundle runs (else it shows "Unmatched Route" under the
 * proxy prefix) and re-points any runtime root-absolute request back through us.
 *
 * PERF: the Metro web bundle is ~4 MB. Rewriting it means buffering + a regex
 * scan, which is expensive — so rewritten JS is cached in module scope (the
 * bundle is immutable for a sandbox's life) and binary assets are streamed
 * through untouched. Without this, repeated iframe loads saturate the dev server.
 */

const PREVIEW_PORT = "8081";
// Lock the upstream host suffix so this can't be turned into an open proxy (SSRF).
const ALLOWED_SUFFIX = process.env.DAYTONA_PREVIEW_SUFFIX || "daytonaproxy01.eu";
const SANDBOX_ID_RE = /^[a-f0-9-]{8,40}$/i;

function sandboxOrigin(id: string): string {
  return `https://${PREVIEW_PORT}-${id}.${ALLOWED_SUFFIX}`;
}

// Cache rewritten JS bundles (and their content-type) keyed by full target URL.
// A handful of ~4 MB strings at most; bounded so it can't grow unbounded.
const jsCache = new Map<string, { body: string; contentType: string }>();
const JS_CACHE_MAX = 8;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; path?: string[] }> }) {
  const { id, path } = await ctx.params;
  if (!SANDBOX_ID_RE.test(id)) return new Response("Invalid sandbox id", { status: 400 });

  // Liveness probe: ?livecheck=1 — fetch the sandbox root with a short timeout,
  // return {alive:boolean}. No bundle caching, no rewriting — just a HEAD-like ping.
  if (req.nextUrl.searchParams.get("livecheck") === "1") {
    const origin = sandboxOrigin(id);
    let alive = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${origin}/`, {
        method: "GET",
        headers: { "X-Daytona-Skip-Preview-Warning": "true", Accept: "text/html" },
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      alive = res.ok || res.status < 500;
    } catch {
      alive = false;
    }
    return new Response(JSON.stringify({ alive }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const origin = sandboxOrigin(id);
  const base = `/api/preview/${id}`;
  const subPath = (path ?? []).join("/");

  // previewAt is a proxy-internal cache-bust discriminator; strip it before
  // forwarding upstream so Metro never sees an unknown query param.
  const previewAt = req.nextUrl.searchParams.get("previewAt");
  const upstreamSearch = (() => {
    const params = new URLSearchParams(req.nextUrl.searchParams);
    params.delete("previewAt");
    const s = params.toString();
    return s ? `?${s}` : "";
  })();
  // Upstream URL has previewAt removed; cache key incorporates it separately.
  const target = `${origin}/${subPath}${upstreamSearch}`;
  const isBundle = /\.(bundle|js)(\?|$)/.test(subPath) || /[?&]platform=web/.test(upstreamSearch);

  // Serve a cached rewritten bundle immediately (skips the 4 MB refetch + regex).
  // Cache key = upstream target + pa=<previewAt> so in-box agent edits bust stale bundles.
  if (isBundle) {
    const cacheKey = buildJsCacheKey(target, previewAt);
    const hit = jsCache.get(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: { "content-type": hit.contentType, "cache-control": "public, max-age=300" },
      });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        "X-Daytona-Skip-Preview-Warning": "true",
        Accept: req.headers.get("accept") ?? "*/*",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
    });
  } catch {
    return new Response(bootHtml("Connecting to preview…"), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // HTML document: small — rewrite asset paths + inject the routing shim.
  // Pass previewAt so the shim can append it to bundle URLs the browser fetches
  // from inside the iframe (those requests never carry previewAt otherwise).
  if (contentType.includes("text/html")) {
    const html = rewriteHtml(await upstream.text(), base, previewAt);
    return new Response(html, {
      status: upstream.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "SAMEORIGIN",
      },
    });
  }

  // JS bundle/chunk: rewrite root-absolute asset paths once, then cache.
  if (contentType.includes("javascript")) {
    const js = rewriteAssetPaths(await upstream.text(), base);
    if (upstream.ok) {
      const cacheKey = buildJsCacheKey(target, previewAt);
      if (jsCache.size >= JS_CACHE_MAX) jsCache.delete(jsCache.keys().next().value!);
      jsCache.set(cacheKey, { body: js, contentType });
    }
    return new Response(js, {
      status: upstream.status,
      headers: { "content-type": contentType, "cache-control": "public, max-age=300" },
    });
  }

  // Everything else (images, fonts, json) — stream straight through, no buffering.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": contentType || "application/octet-stream",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

/** Rewrite the document: re-point assets at the proxy + inject the routing shim. */
function rewriteHtml(html: string, base: string, previewAt: string | null): string {
  // src="/x" / href="/x" → proxy-prefixed (these are root-absolute, ignore <base>).
  // (?!\/) guards against protocol-relative (//...) URLs, same as the original.
  // Bundle script sources (e.g. src="/index.bundle?platform=web") also get
  // previewAt appended so the proxy's jsCache key matches on the initial page load.
  let out = html.replace(/\b(src|href)=("|')(\/(?!\/)[^"']*)(["'])/gi, (_m, attr, q, urlPath, qEnd) => {
    const proxied = `${base}${urlPath}`;
    const withPA = previewAt && /\.(bundle|js)(\?|$)/.test(urlPath)
      ? proxied + (urlPath.includes("?") ? `&previewAt=${previewAt}` : `?previewAt=${previewAt}`)
      : proxied;
    return `${attr}=${q}${withPA}${qEnd}`;
  });
  out = rewriteAssetPaths(out, base);

  // RN-web ScrollViews render with overflow:hidden + touch-action:none, so a
  // desktop wheel/trackpad can't scroll them — the preview feels "stuck".
  // SURGICAL fix: flip ONLY the actual ScrollView marker class
  // (r-WebkitOverflowScrolling). Do NOT touch html/body (Expo keeps them hidden
  // on purpose) or the generic r-overflow* flex classes — doing so collapses
  // RN-web's flex height cascade and pushes content past the device frame.
  const scrollFix = `<style id="stellar-scroll-fix">
  [class*="WebkitOverflowScrolling"]{overflow-y:auto !important;touch-action:pan-y !important;}
</style>`;
  // Bake previewAt into the shim so bundle fetches originating inside the iframe
  // carry it as a query param — those requests never see the document's ?previewAt,
  // so the proxy can't read it from req.nextUrl.searchParams for them. The shim
  // appends &previewAt=<ts> (or ?previewAt=<ts> if no existing ?) to any URL it
  // re-points so the server-side cache key matches on those requests too.
  const PA = JSON.stringify(previewAt ?? "");
  const shim = `${scrollFix}<script>(function(){
  var P=${JSON.stringify(base)};
  var PA=${PA};
  // expo-router reads location.pathname — reset the iframe to root so it matches "/".
  try{ if(location.pathname.indexOf(P)===0){ var rest=location.pathname.slice(P.length)||"/"; history.replaceState(null,"",rest+location.search+location.hash); } }catch(e){}
  // Re-point any runtime root-absolute request back through the proxy.
  // Bundle requests (.bundle, ?platform=web) also get ?previewAt stamped so the
  // server-side jsCache key matches even when the bundle URL has no previewAt.
  function isBundle(u){ return /\.(bundle|js)(\?|$)/.test(u)||u.indexOf("platform=web")!==-1; }
  function addPA(u){ if(!PA) return u; return u+(u.indexOf("?")!==-1?"&previewAt=":"?previewAt=")+PA; }
  function fix(u){ try{ if(typeof u==="string" && u.charAt(0)==="/" && u.charAt(1)!=="/" && u.indexOf(P)!==0){ var r=P+u; return isBundle(u)?addPA(r):r; } }catch(e){} return u; }
  if(window.fetch){ var f=window.fetch; window.fetch=function(i,o){ return f.call(this, typeof i==="string"?fix(i):i, o); }; }
  var xo=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(m,u){ try{arguments[1]=fix(u);}catch(e){} return xo.apply(this,arguments); };
}())</script>`;

  return /<head[^>]*>/i.test(out)
    ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${shim}`)
    : shim + out;
}

/** Re-point root-absolute asset paths Metro emits in HTML/JS strings. */
function rewriteAssetPaths(src: string, base: string): string {
  return src.replace(/(["'`(])\/(node_modules|assets|_expo)\//g, (_m, pre, seg) => `${pre}${base}/${seg}/`);
}

function bootHtml(label: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;background:#0d0c10;color:#fff;font-family:-apple-system,system-ui,sans-serif}
    .c{height:100%;display:flex;align-items:center;justify-content:center;opacity:.7;font-size:14px}
  </style></head><body><div class="c">${label}</div></body></html>`;
}
