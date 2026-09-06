export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ─── /slug?title=xxx&aniId=xxx ────────────────────────────
    if (url.pathname === '/slug') {
      const title = url.searchParams.get('title');
      const aniId = url.searchParams.get('aniId');
      if (!title && !aniId) return json({ error: 'missing title or aniId' }, cors);

      try {
        const q = title || '';
        const r = await fetch('https://anikage.cc/api/media/anime/browse?q=' + encodeURIComponent(q) + '&sort=popularity&page=1&limit=25', {
          headers: {
            'Referer': 'https://anikage.cc/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!r.ok) return json({ error: 'browse returned ' + r.status }, cors);

        const data = await r.json();
        const results = data.data || [];

        // If we have an AniList ID, find exact match first
        if (aniId) {
          const exact = results.find(function(item) {
            return String(item.anilistId) === String(aniId);
          });
          if (exact) {
            return json({ slug: exact.slug, title: exact.title, anilistId: exact.anilistId }, cors);
          }
        }

        // Fall back to first result
        if (results.length > 0) {
          return json({ slug: results[0].slug, title: results[0].title, anilistId: results[0].anilistId, all: results }, cors);
        }

        return json({ error: 'no results found' }, cors);
      } catch(e) {
        return json({ error: 'slug lookup failed: ' + e.message }, cors);
      }
    }

    // ─── /sources?slug=xxx&ep=1 ───────────────────────────────
    if (url.pathname === '/sources') {
      const slug = url.searchParams.get('slug');
      const ep = url.searchParams.get('ep') || '1';
      if (!slug) return json({ error: 'missing slug' }, cors);

      const servers = ['koto', 'neko', 'kiwi', 'wave', 'zen'];
      let sources = null;

      for (let i = 0; i < servers.length; i++) {
        const s = servers[i];
        const apiUrl = 'https://anikage.cc/api/media/anime/' + slug + '/episodes/' + ep + '/sources?provider=' + s + '&lang=dub&server=' + s;
        try {
          const r = await fetch(apiUrl, {
            headers: {
              'Referer': 'https://anikage.cc/',
              'Origin': 'https://anikage.cc',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          if (r.ok) {
            const data = await r.json();
            if (data.sources && data.sources.length > 0) {
              sources = data;
              break;
            }
          }
        } catch (e) {}
      }

      if (!sources) return json({ error: 'no dub sources found' }, cors);

      return json({
        provider: sources.providerId,
        all: sources.sources,
        embeds: sources.embeds
      }, cors);
    }

    // ─── /m3u8?encoded=xxx ────────────────────────────────────
    if (url.pathname === '/m3u8') {
      const encoded = url.searchParams.get('encoded');
      if (!encoded) return json({ error: 'missing encoded' }, cors);

      const m3u8Url = 'https://og.bakayaro.live/m3u8/' + encoded;

      let r;
      try {
        r = await fetch(m3u8Url, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
      } catch (e) {
        return json({ error: 'fetch failed: ' + e.message }, cors);
      }

      if (!r.ok) return json({ error: 'bakayaro returned ' + r.status }, cors);

      let text = await r.text();
      const workerOrigin = url.origin;

      // Rewrite quality playlist URLs
      text = text.replace(/https:\/\/og\.bakayaro\.live\/m3u8\/([^\s]+)/g, function(match, enc) {
        return workerOrigin + '/m3u8?encoded=' + enc;
      });

      // Rewrite absolute segment URLs
      text = text.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s]+)/g, function(match, seg) {
        return workerOrigin + '/segment?url=' + encodeURIComponent('https://og.bakayaro.live/stream/' + seg);
      });

      // Rewrite relative segment URLs starting with /stream/
      text = text.replace(/^\/stream\/([^\s]+)/gm, function(match, seg) {
        return workerOrigin + '/segment?url=' + encodeURIComponent('https://og.bakayaro.live/stream/' + seg);
      });

      // Rewrite bare encoded tokens
      text = text.replace(/^(DB5BNE[^\s]+)/gm, function(match) {
        return workerOrigin + '/m3u8?encoded=' + match;
      });

      return new Response(text, {
        headers: Object.assign({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache'
        }, cors)
      });
    }

    // ─── /segment?url=xxx ─────────────────────────────────────
    if (url.pathname === '/segment') {
      const segUrl = url.searchParams.get('url');
      if (!segUrl) return json({ error: 'missing url' }, cors);

      let r;
      try {
        r = await fetch(segUrl, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
      } catch (e) {
        return new Response('segment fetch failed: ' + e.message, { status: 500, headers: cors });
      }

      if (!r.ok) {
        return new Response('segment returned ' + r.status, { status: r.status, headers: cors });
      }

      return new Response(r.body, {
        headers: Object.assign({
          'Content-Type': 'video/MP2T',
          'Cache-Control': 'max-age=3600'
        }, cors)
      });
    }

    // ─── /episodes?slug=xxx ───────────────────────────────────
    if (url.pathname === '/episodes') {
      const slug = url.searchParams.get('slug');
      if (!slug) return json({ error: 'missing slug' }, cors);

      try {
        const r = await fetch('https://anikage.cc/api/media/anime/' + slug + '/episodes', {
          headers: {
            'Referer': 'https://anikage.cc/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (r.ok) {
          const text = await r.text();
          return new Response(text, {
            headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
          });
        }
        return json({ error: 'episodes returned ' + r.status }, cors);
      } catch(e) {
        return json({ error: 'episodes failed: ' + e.message }, cors);
      }
    }

    // ─── root ─────────────────────────────────────────────────
    return json({
      name: 'LegacyStream Worker',
      version: '2.0',
      routes: [
        '/slug?title={title}&aniId={anilistId}',
        '/episodes?slug={anikage_slug}',
        '/sources?slug={anikage_slug}&ep={number}',
        '/m3u8?encoded={encoded_from_sources}',
        '/segment?url={segment_url}'
      ]
    }, cors);
  }
};

function json(obj, cors) {
  return new Response(JSON.stringify(obj), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}
