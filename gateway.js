// NexusVibe Edge Gateway - Optimized for Wasmer WinterJS
const FALLBACK_SITE = "https://ir-netlify.github.io/NETLIFY/new/new.html";

// Web safe headers to sanitize
const SANITIZE_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "x-host"
]);

function resolveUpstreamUrl(targetHost, path, query) {
  let cleanHost = targetHost.trim();
  if (!cleanHost.startsWith('http://') && !cleanHost.startsWith('https://')) {
    cleanHost = `https://${cleanHost}`;
  }
  return `${cleanHost}${path}${query}`;
}

export default async function(req) {
  try {
    const url = new URL(req.url);
    const targetHost = req.headers.get("x-host");

    // Static fallback landing page
    if (!targetHost) {
      if (url.pathname === "/") {
        const landingPage = await fetch(FALLBACK_SITE);
        return new Response(await landingPage.text(), {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      }
      return new Response(JSON.stringify({ error: "Bad Request", message: "Missing routing context (x-host)." }), { 
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    // Clone and clean request headers
    const forwardHeaders = new Headers();
    for (const [key, val] of req.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (!SANITIZE_HEADERS.has(lowerKey)) {
        forwardHeaders.set(key, val);
      }
    }

    // Set standard User-Agent if empty
    if (!forwardHeaders.has("user-agent")) {
      forwardHeaders.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    }

    const method = req.method;
    const destination = resolveUpstreamUrl(targetHost, url.pathname, url.search);

    // Read body safely for non-GET requests
    let requestBody = undefined;
    if (method !== "GET" && method !== "HEAD") {
      requestBody = await req.arrayBuffer();
    }

    // Forward request to final destination
    const response = await fetch(destination, {
      method: method,
      headers: forwardHeaders,
      redirect: "manual",
      body: requestBody,
    });

    // Clean upstream response headers
    const cleanResponseHeaders = new Headers();
    for (const [key, val] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "transfer-encoding" && lowerKey !== "content-encoding") {
        cleanResponseHeaders.set(key, val);
      }
    }

    // Collect response data to prevent open stream leaks on Wasmer
    const responseData = await response.arrayBuffer();

    return new Response(responseData, {
      status: response.status,
      headers: cleanResponseHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ status: 502, message: "Bridge connection failed.", details: err.message }), { 
      status: 502,
      headers: { "content-type": "application/json" }
    });
  }
}
