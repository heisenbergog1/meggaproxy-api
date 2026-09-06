export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, *',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/debug') {
      const info = { method: request.method, url: request.url, headers: {} };
      request.headers.forEach((val, key) => { info.headers[key] = val; });
      return new Response(JSON.stringify(info, null, 2), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    // ==========================================
    // 1. Search Anime Slug
    // ==========================================
    if (url.pathname === '/slug') {
      const title = url.searchParams.get('title');
      const aniId = url.searchParams.get('aniId');
      if (!title && !aniId) return json({ error: 'missing title or aniId' }, cors);
      try {
        const q = title || '';
        const r = await fetch('https://anikage.cc/api/media/anime/browse?q=' + encodeURIComponent(q) + '&sort=popularity&page=1&limit=25', {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (!r.ok) return json({ error: 'browse returned ' + r.status }, cors);
        const data = await r.json();
        const results = data.data || [];
        if (aniId) {
          for (let i = 0; i < results.length; i++) {
            if (String(results[i].anilistId) === String(aniId)) {
              return json({ slug: results[i].slug, title: results[i].title, anilistId: results[i].anilistId }, cors);
            }
          }
        }
        if (results.length > 0) return json({ slug: results[0].slug, title: results[0].title, anilistId: results[0].anilistId }, cors);
        return json({ error: 'no results found' }, cors);
      } catch (e) { return json({ error: 'slug lookup failed: ' + e.message }, cors); }
    }

    // ==========================================
    // 2. Fetch Episodes
    // ==========================================
    if (url.pathname === '/episodes') {
      const slug = url.searchParams.get('slug');
      if (!slug) return json({ error: 'missing slug' }, cors);
      try {
        const r = await fetch('https://anikage.cc/api/media/anime/' + slug + '/episodes', {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (r.ok) {
          const text = await r.text();
          return new Response(text, { headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
        }
        return json({ error: 'episodes returned ' + r.status }, cors);
      } catch (e) { return json({ error: 'episodes failed: ' + e.message }, cors); }
    }

    // ==========================================
    // 3. Fetch DUB Sources (HD1 Bakayaro & HD2 Vidtube)
    // ==========================================
    if (url.pathname === '/sources') {
      const slug = url.searchParams.get('slug');
      const ep = url.searchParams.get('ep') || '1';
      // Default to DUB
      const lang = (url.searchParams.get('lang') || 'dub').toLowerCase();
      if (!slug) return json({ error: 'missing slug' }, cors);
      
      const servers = ['koto', 'neko', 'kiwi', 'wave', 'zen'];
      let sources = null;
      for (let i = 0; i < servers.length; i++) {
        const s = servers[i];
        try {
          const r = await fetch('https://anikage.cc/api/media/anime/' + slug + '/episodes/' + ep + '/sources?provider=' + s + '&lang=' + lang + '&server=' + s, {
            headers: {
              'Referer': 'https://anikage.cc/',
              'Origin': 'https://anikage.cc',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
      if (!sources) return json({ error: 'no ' + lang + ' sources found' }, cors);
      return json({ 
        lang: lang,
        provider: sources.providerId, 
        all: sources.sources, 
        embeds: sources.embeds 
      }, cors);
    }

    // ==========================================
    // 4. HD1 (Bakayaro) M3U8 Resolver - Highest Quality Dub
    // ==========================================
    if (url.pathname === '/m3u8') {
      const encoded = url.searchParams.get('encoded');
      const pick = url.searchParams.get('pick') || 'highest';
      if (!encoded) return json({ error: 'missing encoded' }, cors);

      const m3u8Url = 'https://og.bakayaro.live/m3u8/' + encoded;
      const workerOrigin = url.origin;

      let r;
      try {
        r = await fetch(m3u8Url, {
          headers: {
            'Referer': 'https://anikage.cc/',
            'Origin': 'https://anikage.cc',
            'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1',
            'Accept': '*/*'
          }
        });
      } catch (e) { return json({ error: 'fetch failed: ' + e.message }, cors); }

      if (!r.ok) return json({ error: 'bakayaro returned ' + r.status }, cors);

      let text = await r.text();
      const isMaster = text.includes('EXT-X-STREAM-INF');

      if (isMaster) {
        const lines = text.split('\n');
        const headerLines = [];
        const variants = [];
        let currentInf = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (line.startsWith('#EXT-X-STREAM-INF')) {
            currentInf = line;
          } else if (currentInf) {
            const bwMatch = currentInf.match(/BANDWIDTH=(\d+)/);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            variants.push({ inf: currentInf, line: line, bw: bw });
            currentInf = null;
          } else {
            headerLines.push(line);
          }
        }

        // Sort Highest Bandwidth (1080p) First
        variants.sort((a, b) => b.bw - a.bw);

        // Fetch Highest Quality sub-playlist directly
        if (pick === 'highest' && variants.length > 0) {
          const bestTarget = variants[0].line;
          let bestToken = bestTarget;
          
          if (bestTarget.includes('encoded=')) {
            bestToken = bestTarget.split('encoded=')[1].split('&')[0];
          } else if (bestTarget.includes('/m3u8/')) {
            bestToken = bestTarget.split('/m3u8/')[1].split('?')[0];
          }

          const qualUrl = bestTarget.startsWith('http') ? bestTarget : ('https://og.bakayaro.live/m3u8/' + bestToken);
          try {
            const qr = await fetch(qualUrl, {
              headers: {
                'Referer': 'https://anikage.cc/',
                'Origin': 'https://anikage.cc',
                'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1'
              }
            });
            if (qr.ok) {
              let subText = await qr.text();
              // Rewrite all TS segments & AES-128 keys to route through worker
              subText = subText.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s\r\n]+)/g, `${workerOrigin}/seg/$1`);
              subText = subText.replace(/^\/stream\/([^\s\r\n]+)/gm, `${workerOrigin}/seg/$1`);
              subText = subText.replace(/URI="([^"]+)"/g, (m, keyUrl) => {
                const absKey = keyUrl.startsWith('http') ? keyUrl : `https://og.bakayaro.live${keyUrl.startsWith('/') ? '' : '/'}${keyUrl}`;
                return `URI="${workerOrigin}/proxy?url=${encodeURIComponent(absKey)}"`;
              });

              return new Response(subText, {
                headers: Object.assign({
                  'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                  'Cache-Control': 'no-cache, no-store',
                  'X-Content-Type-Options': 'nosniff'
                }, cors)
              });
            }
          } catch (e) {}
        }

        // Fallback: Reorder master playlist so iPad native player picks 1080p first
        const outLines = [...headerLines];
        for (const v of variants) {
          outLines.push(v.inf);
          let target = v.line;
          let token = target;
          if (target.includes('encoded=')) token = target.split('encoded=')[1].split('&')[0];
          else if (target.includes('/m3u8/')) token = target.split('/m3u8/')[1].split('?')[0];
          outLines.push(`${workerOrigin}/m3u8?encoded=${token}&pick=highest`);
        }
        text = outLines.join('\n');
      }

      // Rewrite any direct segment/m3u8 paths
      text = text.replace(/https:\/\/og\.bakayaro\.live\/m3u8\/([^\s\r\n]+)/g, `${workerOrigin}/m3u8?encoded=$1`);
      text = text.replace(/https:\/\/og\.bakayaro\.live\/stream\/([^\s\r\n]+)/g, `${workerOrigin}/seg/$1`);
      text = text.replace(/^\/stream\/([^\s\r\n]+)/gm, `${workerOrigin}/seg/$1`);
      text = text.replace(/^(DB5BNE[^\s\r\n]+)/gm, `${workerOrigin}/m3u8?encoded=$1`);
      text = text.replace(/URI="([^"]+)"/g, (m, keyUrl) => {
        const absKey = keyUrl.startsWith('http') ? keyUrl : `https://og.bakayaro.live${keyUrl.startsWith('/') ? '' : '/'}${keyUrl}`;
        return `URI="${workerOrigin}/proxy?url=${encodeURIComponent(absKey)}"`;
      });

      return new Response(text, {
        headers: Object.assign({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-cache, no-store',
          'X-Content-Type-Options': 'nosniff'
        }, cors)
      });
    }

    // ==========================================
    // 5. HD2 (Vidtube) M3U8 Quality Selector & Proxy
    // ==========================================
    if (url.pathname === '/vidtube' || url.pathname === '/m3u8-proxy') {
      const targetM3u8 = url.searchParams.get('url');
      if (!targetM3u8) return json({ error: 'missing url' }, cors);

      const workerOrigin = url.origin;
      let vidReferer = 'https://vidtube.pro/';
      if (targetM3u8.includes('anikage.cc')) vidReferer = 'https://anikage.cc/';

      let r;
      try {
        r = await fetch(targetM3u8, {
          headers: {
            'Referer': vidReferer,
            'Origin': vidReferer.replace(/\/$/, ''),
            'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1',
            'Accept': '*/*'
          }
        });
      } catch (e) { return json({ error: 'vidtube fetch failed: ' + e.message }, cors); }

      if (!r.ok) return json({ error: 'upstream returned ' + r.status }, cors);

      let text = await r.text();
      const baseUrl = targetM3u8.substring(0, targetM3u8.lastIndexOf('/') + 1);

      if (text.includes('#EXT-X-STREAM-INF')) {
        const lines = text.split('\n');
        const headerLines = [];
        const variants = [];
        let currentInf = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (line.startsWith('#EXT-X-STREAM-INF')) {
            currentInf = line;
          } else if (currentInf) {
            let absUrl = line;
            if (!line.startsWith('http://') && !line.startsWith('https://')) {
              absUrl = baseUrl + line;
            }
            const bwMatch = currentInf.match(/BANDWIDTH=(\d+)/);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            variants.push({ inf: currentInf, url: absUrl, bw: bw });
            currentInf = null;
          } else {
            headerLines.push(line);
          }
        }

        // Sort descending: 1080p > 720p > 480p > 360p
        variants.sort((a, b) => b.bw - a.bw);

        const outLines = [...headerLines];
        for (const v of variants) {
          outLines.push(v.inf);
          outLines.push(`${workerOrigin}/vidtube?url=${encodeURIComponent(v.url)}`);
        }
        text = outLines.join('\n');
      } else {
        // Media segment playlist
        const lines = text.split('\n');
        const rewrittenLines = lines.map(line => {
          line = line.trim();
          if (!line) return line;
          if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
            return line.replace(/URI="([^"]+)"/g, (m, keyUrl) => {
              const absKey = (!keyUrl.startsWith('http://') && !keyUrl.startsWith('https://')) ? baseUrl + keyUrl : keyUrl;
              return `URI="${workerOrigin}/proxy?url=${encodeURIComponent(absKey)}"`;
            });
          }
          if (line.startsWith('#')) return line;
          let absSeg = line;
          if (!line.startsWith('http://') && !line.startsWith('https://')) {
            absSeg = baseUrl + line;
          }
          return `${workerOrigin}/proxy?url=${encodeURIComponent(absSeg)}`;
        });
        text = rewrittenLines.join('\n');
      }

      return new Response(text, {
        headers: Object.assign({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }, cors)
      });
    }

    // ==========================================
    // 6. Bakayaro Segment Route (/seg/:token)
    // ==========================================
    if (url.pathname.startsWith('/seg/')) {
      const seg = url.pathname.slice(5);
      const segUrl = 'https://og.bakayaro.live/stream/' + seg;
      return proxyMedia(segUrl, request, cors, 'https://anikage.cc/');
    }

    // ==========================================
    // 7. Universal Segment & Key Proxy (/proxy & /segment)
    // ==========================================
    if (url.pathname === '/proxy' || url.pathname === '/segment') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return json({ error: 'missing url' }, cors);

      let referer = 'https://anikage.cc/';
      if (targetUrl.includes('vidtube')) referer = 'https://vidtube.pro/';
      else if (targetUrl.includes('bakayaro')) referer = 'https://anikage.cc/';

      return proxyMedia(targetUrl, request, cors, referer);
    }

    return json({
      name: 'MeggaProxy API',
      status: 'active',
      defaultAudio: 'dub',
      routes: [
        '/slug?title={title}&aniId={id}',
        '/episodes?slug={slug}',
        '/sources?slug={slug}&ep={ep}&lang=dub',
        '/m3u8?encoded={token}&pick=highest',
        '/vidtube?url={m3u8Url}',
        '/seg/{token}',
        '/proxy?url={url}'
      ]
    }, cors);
  }
};

async function proxyMedia(mediaUrl, request, cors, referer) {
  const fetchHeaders = {
    'Referer': referer,
    'Origin': referer.replace(/\/$/, ''),
    'User-Agent': 'Mozilla/5.0 (AppleWebKit/605.1.15) Mobile/15E148 Safari/604.1',
    'Accept': '*/*'
  };

  const range = request.headers.get('Range');
  if (range) fetchHeaders['Range'] = range;

  // Handle HEAD requests for iPad AVPlayer probing
  if (request.method === 'HEAD') {
    try {
      const r = await fetch(mediaUrl, { method: 'HEAD', headers: fetchHeaders });
      const h = Object.assign({
        'Content-Type': r.headers.get('Content-Type') || 'video/MP2T',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      }, cors);
      if (r.headers.get('Content-Length')) h['Content-Length'] = r.headers.get('Content-Length');
      return new Response(null, { status: r.status, headers: h });
    } catch (e) {
      return new Response(null, { status: 200, headers: cors });
    }
  }

  try {
    const r = await fetch(mediaUrl, { headers: fetchHeaders });
    const respHeaders = Object.assign({
      'Content-Type': r.headers.get('Content-Type') || (mediaUrl.includes('.key') ? 'application/octet-stream' : 'video/MP2T'),
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes'
    }, cors);

    if (r.headers.get('Content-Length')) respHeaders['Content-Length'] = r.headers.get('Content-Length');
    if (r.headers.get('Content-Range')) respHeaders['Content-Range'] = r.headers.get('Content-Range');

    return new Response(r.body, { status: r.status, headers: respHeaders });
  } catch (e) {
    return new Response('Fetch failed: ' + e.message, { status: 502, headers: cors });
  }
}

function json(obj, cors) {
  return new Response(JSON.stringify(obj), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}
