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

      // Pick best quality — prefer hd-1 (megaplay) over hd-2
      let best = null;
      for (let i = 0; i < sources.sources.length; i++) {
        if (sources.sources[i].quality === 'hd-1') {
          best = sources.sources[i];
          break;
        }
      }
      if (!best) best = sources.sources[0];

      return json({
        encoded: best.url,
        quality: best.quality,
        embedUrl: best.embedUrl,
        provider: sources.providerId
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

      // Rewrite quality playlist URLs (og.bakayaro.live/m3u8/...)
      text = text.replace(/https:\/\/og\.bakayaro\.live\/m3u8\/([^\s]+)/g, function(match, enc) {
        return workerOrigin + '/m3u8?encoded=' + enc;
      });

      // Rewrite absolute segment URLs (og.bakayaro.live/stream/...)
      text = text.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s]+)/g, function(match, seg) {
        return workerOrigin + '/segment?url=' + encodeURIComponent('https://og.bakayaro.live/stream/' + seg);
      });

      // Rewrite relative segment URLs (/stream/...)
      text = text.replace(/^\/stream\/([^\s]+)/gm, function(match, seg) {
        return workerOrigin + '/segment?url=' + encodeURIComponent('https://og.bakayaro.live/stream/' + seg);
      });

      // Rewrite any bare relative paths that are just the encoded token
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

    // ─── /segment?url=https://og.bakayaro.live/stream/... ────
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

    // ─── /search?q=naruto ─────────────────────────────────────
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q');
      if (!q) return json({ error: 'missing q' }, cors);

      try {
        const r = await fetch('https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(q) + '&limit=20&type=tv', {
          headers: { 'User-Agent': 'LegacyStream/1.0' }
        });
        const data = await r.json();
        return json(data, cors);
      } catch (e) {
        return json({ error: 'search failed: ' + e.message }, cors);
      }
    }

    // ─── /slug?title=Naruto ───────────────────────────────────
    if (url.pathname === '/slug') {
      const title = url.searchParams.get('title');
      if (!title) return json({ error: 'missing title' }, cors);

      try {
        const searchUrl = 'https://anikage.cc/api/media/search?q=' + encodeURIComponent(title);
        const r = await fetch(searchUrl, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (r.ok) {
          const data = await r.json();
          return json(data, cors);
        }
        return json({ error: 'anikage search returned ' + r.status }, cors);
      } catch (e) {
        return json({ error: 'slug lookup failed: ' + e.message }, cors);
      }
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
          const data = await r.json();
          return json(data, cors);
        }
        return json({ error: 'episodes returned ' + r.status }, cors);
      } catch (e) {
        return json({ error: 'episodes failed: ' + e.message }, cors);
      }
    }

    // ─── root ─────────────────────────────────────────────────
    return json({
      name: 'LegacyStream Worker',
      version: '1.0',
      routes: [
        '/search?q={title}',
        '/slug?title={title}',
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