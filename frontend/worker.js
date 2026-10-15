/*
 * The writer's app at breader.site/writer: a Cloudflare Worker on that route, in front of breader's
 * own site on Cloudflare Pages, serving the app's build (dist/, made with base /writer/). It runs
 * before any file (run_worker_first in wrangler.jsonc), since the files sit at the build's root:
 * /writer/assets/x.js is the build's /assets/x.js. Every page of the app (/writer/books/<id> and
 * the rest) is answered with index.html, which routes itself; a file that isn't there is a 404.
 * Deployed by Cloudflare's Workers Builds on every push to dev (infra/README.md).
 */
const BASE = '/writer';

/** A page the app routes itself rather than a file: the last part of its path has no extension. */
function isPage(path) {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !last.includes('.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === BASE) {
      url.pathname = `${BASE}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (!url.pathname.startsWith(`${BASE}/`)) {
      return new Response('Not found', { status: 404 });
    }

    const file = new URL(url);
    file.pathname = url.pathname.slice(BASE.length);
    const found = await env.ASSETS.fetch(new Request(file, request));
    if (found.status !== 404 || !isPage(file.pathname)) {
      return found;
    }
    file.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(file, request));
  },
};
