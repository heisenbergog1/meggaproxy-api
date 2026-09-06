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

    if (url.pathname === '/debug') {
      var info = { method: request.method, url: request.url, headers: {} };
      request.headers.forEach(function(val, key) { info.headers[key] = val; });
      return new Response(JSON.stringify(info, null, 2), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    if (url.pathname === '/debug-segment') {
      const segUrl = url.searchParams.get('url');
      if (!segUrl) return json({ error: 'missing url' }, cors);
      var debugInfo = { segUrl, requestHeaders: {}, responseStatus: null, responseHeaders: {}, responseSize: null, error: null, incomingHeaders: {} };
      request.headers.forEach(function(val, key) { debugInfo.incomingHeaders[key] = val; });
      var fetchHeaders = {
        'Referer': 'https://anikage.cc/',
        'Origin': 'https://anikage.cc',
        'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
      };
      var range = request.headers.get('Range');
      if (range) { fetchHeaders['Range'] = range; debugInfo.rangeHeader = range; }
      debugInfo.requestHeaders = fetchHeaders;
      try {
        var r = await fetch(segUrl, { headers: fetchHeaders });
        debugInfo.responseStatus = r.status;
        r.headers.forEach(function(val, key) { debugInfo.responseHeaders[key] = val; });
        var body = await r.arrayBuffer();
        debugInfo.responseSize = body.byteLength;
        debugInfo.success = r.ok;
      } catch(e) { debugInfo.error = e.message; }
      return new Response(JSON.stringify(debugInfo, null, 2), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    if (url.pathname === '/debug-m3u8') {
      const encoded = url.searchParams.get('encoded');
      if (!encoded) return json({ error: 'missing encoded' }, cors);
      var debugInfo = { encoded, m3u8Url: 'https://og.bakayaro.live/m3u8/' + encoded, incomingHeaders: {}, responseStatus: null, responseHeaders: {}, rawContent: null, error: null };
      request.headers.forEach(function(val, key) { debugInfo.incomingHeaders[key] = val; });
      try {
        var r = await fetch('https://og.bakayaro.live/m3u8/' + encoded, {
          headers: { 'Referer': 'https://anikage.cc/', 'Origin': 'https://anikage.cc', 'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1' }
        });
        debugInfo.responseStatus = r.status;
        r.headers.forEach(function(val, key) { debugInfo.responseHeaders[key] = val; });
        debugInfo.rawContent = await r.text();
      } catch(e) { debugInfo.error = e.message; }
      return new Response(JSON.stringify(debugInfo, null, 2), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    if (url.pathname === '/slug') {
      const title = url.searchParams.get('title');
      const aniId = url.searchParams.get('aniId');
      if (!title && !aniId) return json({ error: 'missing title or aniId' }, cors);
      try {
        const q = title || '';
        const r = await fetch('https://anikage.cc/api/media/anime/browse?q=' + encodeURIComponent(q) + '&sort=popularity&page=1&limit=25', {
          headers: { 'Referer': 'https://anikage.cc/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
        });
        if (!r.ok) return json({ error: 'browse returned ' + r.status }, cors);
        const data = await r.json();
        const results = data.data || [];
        if (aniId) {
          for (var i = 0; i < results.length; i++) {
            if (String(results[i].anilistId) === String(aniId)) {
              return json({ slug: results[i].slug, title: results[i].title, anilistId: results[i].anilistId }, cors);
            }
          }
        }
        if (results.length > 0) return json({ slug: results[0].slug, title: results[0].title, anilistId: results[0].anilistId }, cors);
        return json({ error: 'no results found' }, cors);
      } catch(e) { return json({ error: 'slug lookup failed: ' + e.message }, cors); }
    }

    if (url.pathname === '/sources') {
      const slug = url.searchParams.get('slug');
      const ep = url.searchParams.get('ep') || '1';
      if (!slug) return json({ error: 'missing slug' }, cors);
      const servers = ['koto', 'neko', 'kiwi', 'wave', 'zen'];
      let sources = null;
      for (let i = 0; i < servers.length; i++) {
        const s = servers[i];
        try {
          const r = await fetch('https://anikage.cc/api/media/anime/' + slug + '/episodes/' + ep + '/sources?provider=' + s + '&lang=dub&server=' + s, {
            headers: { 'Referer': 'https://anikage.cc/', 'Origin': 'https://anikage.cc', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'X-Requested-With': 'XMLHttpRequest' }
          });
          if (r.ok) {
            const data = await r.json();
            if (data.sources && data.sources.length > 0) { sources = data; break; }
          }
        } catch (e) {}
      }
      if (!sources) return json({ error: 'no dub sources found' }, cors);
      return json({ provider: sources.providerId, all: sources.sources, embeds: sources.embeds }, cors);
    }

    if (url.pathname === '/m3u8') {
      const encoded = url.searchParams.get('encoded');
      const pick = url.searchParams.get('pick');
      if (!encoded) return json({ error: 'missing encoded' }, cors);

      const m3u8Url = 'https://og.bakayaro.live/m3u8/' + encoded;
      const workerOrigin = url.origin;

      let r;
      try {
        r = await fetch(m3u8Url, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
          }
        });
      } catch (e) { return json({ error: 'fetch failed: ' + e.message }, cors); }

      if (!r.ok) return json({ error: 'bakayaro returned ' + r.status }, cors);

      let text = await r.text();

      var isMaster = text.indexOf('EXT-X-STREAM-INF') > -1;

      if (isMaster && pick === 'highest') {
        var lines = text.split('\n');
        var best = null;
        var bestBandwidth = 0;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('EXT-X-STREAM-INF') > -1) {
            var bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
            var bw = bwMatch ? parseInt(bwMatch[1]) : 0;
            var nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
            if (nextLine && bw >= bestBandwidth) {
              bestBandwidth = bw;
              best = nextLine;
            }
          }
        }

        if (best) {
          var encMatch = best.match(/encoded=([^\s&]+)/);
          if (encMatch) {
            var qualUrl = 'https://og.bakayaro.live/m3u8/' + encMatch[1];
            try {
              var qr = await fetch(qualUrl, {
                headers: {
                  'Referer': 'https://anikage.cc/',
                  'Origin': 'https://anikage.cc',
                  'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
                }
              });
              if (qr.ok) {
                text = await qr.text();
                text = text.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s\r\n]+)/g, function(match, seg) {
                  return workerOrigin + '/seg/' + seg;
                });
                text = text.replace(/^\/stream\/([^\s\r\n]+)/gm, function(match, seg) {
                  return workerOrigin + '/seg/' + seg;
                });
                return new Response(text, {
                  headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache, no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                  }
                });
              }
            } catch(e) {}
          }
        }
      }

      text = text.replace(/https:\/\/og\.bakayaro\.live\/m3u8\/([^\s\r\n]+)/g, function(match, enc) {
        return workerOrigin + '/m3u8?encoded=' + enc;
      });

      text = text.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s\r\n]+)/g, function(match, seg) {
        return workerOrigin + '/seg/' + seg;
      });
      text = text.replace(/^\/stream\/([^\s\r\n]+)/gm, function(match, seg) {
        return workerOrigin + '/seg/' + seg;
      });
      text = text.replace(/^(DB5BNE[^\s\r\n]+)/gm, function(match) {
        return workerOrigin + '/m3u8?encoded=' + match;
      });

      return new Response(text, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }

    if (url.pathname.startsWith('/seg/')) {
      var seg = url.pathname.slice(5);
      var segUrl = 'https://og.bakayaro.live/stream/' + seg;

      var fetchHeaders = {
        'Referer': 'https://anikage.cc/',
        'Origin': 'https://anikage.cc',
        'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
      };

      var range = request.headers.get('Range');
      if (range) fetchHeaders['Range'] = range;

      let r;
      try {
        r = await fetch(segUrl, { headers: fetchHeaders });
      } catch(e) {
        return new Response('seg fetch failed: ' + e.message, { status: 500, headers: cors });
      }

      if (!r.ok && r.status !== 206) {
        return new Response('seg returned ' + r.status, { status: r.status, headers: cors });
      }

      var respHeaders = {
        'Content-Type': 'video/MP2T',
        'Cache-Control': 'max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'X-Content-Type-Options': 'nosniff',
      };

      var contentLength = r.headers.get('Content-Length');
      var acceptRanges  = r.headers.get('Accept-Ranges');
      var contentRange  = r.headers.get('Content-Range');
      if (contentLength) respHeaders['Content-Length'] = contentLength;
      if (acceptRanges)  respHeaders['Accept-Ranges']  = acceptRanges;
      if (contentRange)  respHeaders['Content-Range']  = contentRange;

      return new Response(r.body, { status: r.status, headers: respHeaders });
    }

    if (url.pathname === '/segment') {
      const segUrl = url.searchParams.get('url');
      if (!segUrl) return json({ error: 'missing url' }, cors);

      var fetchHeaders = {
        'Referer': 'https://anikage.cc/',
        'Origin': 'https://anikage.cc',
        'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
      };

      var range = request.headers.get('Range');
      if (range) fetchHeaders['Range'] = range;

      let r;
      try {
        r = await fetch(segUrl, { headers: fetchHeaders });
      } catch(e) {
        return new Response('segment fetch failed: ' + e.message, { status: 500, headers: cors });
      }

      if (!r.ok && r.status !== 206) {
        return new Response('segment returned ' + r.status, { status: r.status, headers: cors });
      }

      var respHeaders = {
        'Content-Type': 'video/MP2T',
        'Cache-Control': 'max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'X-Content-Type-Options': 'nosniff',
      };

      var contentLength = r.headers.get('Content-Length');
      var acceptRanges  = r.headers.get('Accept-Ranges');
      var contentRange  = r.headers.get('Content-Range');
      if (contentLength) respHeaders['Content-Length'] = contentLength;
      if (acceptRanges)  respHeaders['Accept-Ranges']  = acceptRanges;
      if (contentRange)  respHeaders['Content-Range']  = contentRange;

      return new Response(r.body, { status: r.status, headers: respHeaders });
    }

    if (url.pathname === '/episodes') {
      const slug = url.searchParams.get('slug');
      if (!slug) return json({ error: 'missing slug' }, cors);
      try {
        const r = await fetch('https://anikage.cc/api/media/anime/' + slug + '/episodes', {
          headers: { 'Referer': 'https://anikage.cc/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
        });
        if (r.ok) {
          const text = await r.text();
          return new Response(text, { headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
        }
        return json({ error: 'episodes returned ' + r.status }, cors);
      } catch(e) { return json({ error: 'episodes failed: ' + e.message }, cors); }
    }

    return json({
      name: 'LegacyStream Worker',
      version: '5.0',
      routes: [
        '/debug',
        '/debug-segment?url={url}',
        '/debug-m3u8?encoded={encoded}',
        '/slug?title={title}&aniId={anilistId}',
        '/episodes?slug={slug}',
        '/sources?slug={slug}&ep={number}',
        '/m3u8?encoded={encoded}&pick=highest',
        '/seg/{token}',
        '/segment?url={url}'
      ]
    }, cors);
  }
};

function json(obj, cors) {
  return new Response(JSON.stringify(obj), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}