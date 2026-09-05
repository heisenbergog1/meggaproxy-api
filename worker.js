export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Route: /sources?slug=hcmWMvMUoE&ep=3
    if (url.pathname === '/sources') {
      const slug = url.searchParams.get('slug');
      const ep = url.searchParams.get('ep') || '1';
      if (!slug) return json({ error: 'missing slug' }, cors);

      const servers = ['neko', 'kiwi', 'koto', 'wave', 'zen'];
      let sources = null;

      for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        var apiUrl = 'https://anikage.cc/api/media/anime/' + slug + '/episodes/' + ep + '/sources?provider=' + s + '&lang=dub&server=' + s;
        var r = await fetch(apiUrl, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (r.ok) {
          var data = await r.json();
          if (data.sources && data.sources.length > 0) {
            sources = data;
            break;
          }
        }
      }

      if (!sources) return json({ error: 'no dub sources found' }, cors);

      // Pick best quality
      var best = null;
      for (var i = 0; i < sources.sources.length; i++) {
        if (sources.sources[i].quality && sources.sources[i].quality.indexOf('HD-2') > -1) {
          best = sources.sources[i];
          break;
        }
      }
      if (!best) best = sources.sources[0];

      return json({ encoded: best.url, quality: best.quality }, cors);
    }

    // Route: /m3u8?encoded=DB5BNE...
    if (url.pathname === '/m3u8') {
      const encoded = url.searchParams.get('encoded');
      if (!encoded) return json({ error: 'missing encoded' }, cors);

      const m3u8Url = 'https://og.bakayaro.live/m3u8/' + encoded;
      const r = await fetch(m3u8Url, {
        headers: {
          'Referer': 'https://anikage.cc/',
          'Origin': 'https://anikage.cc',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!r.ok) return json({ error: 'bakayaro returned ' + r.status }, cors);

      var text = await r.text();

      // Rewrite quality playlist URLs to go through our worker
      var workerBase = url.origin + '/m3u8?encoded=';
      text = text.replace(/https:\/\/og\.bakayaro\.live\/m3u8\/([^\s]+)/g, function(match, enc) {
        return workerBase + enc;
      });

      return new Response(text, {
        headers: Object.assign({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache'
        }, cors)
      });
    }

    // Route: /segment?url=https://og.bakayaro.live/stream/...
    if (url.pathname === '/segment') {
      const segUrl = url.searchParams.get('url');
      if (!segUrl) return json({ error: 'missing url' }, cors);

      const r = await fetch(segUrl, {
        headers: {
          'Referer': 'https://anikage.cc/',
          'Origin': 'https://anikage.cc',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
      });

      return new Response(r.body, {
        headers: Object.assign({
          'Content-Type': 'video/MP2T',
          'Cache-Control': 'max-age=3600'
        }, cors)
      });
    }

    return json({ error: 'unknown route' }, cors);
  }
};

function json(obj, cors) {
  return new Response(JSON.stringify(obj), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}