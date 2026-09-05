export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    if (url.pathname === '/ping') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname === '/megascrape') {
      const streamId = url.searchParams.get('id');
      if (!streamId) return new Response(JSON.stringify({ error: 'Missing id' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

      try {
        const embedUrl = 'https://megaplay.buzz/stream/s-2/' + streamId + '/dub?s=tcdn&autostart=true';

        const embedRes = await fetch(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://anikoto.cz/',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site'
          }
        });

        const html = await embedRes.text();
        const fileIdMatch = html.match(/File (\d+) - MegaPlay/);
        if (!fileIdMatch) {
          return new Response(JSON.stringify({
            error: 'Could not extract file ID',
            preview: html.substring(0, 500)
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const fileId = fileIdMatch[1];

        const sourcesRes = await fetch('https://megaplay.buzz/stream/getSources?id=' + fileId + '&id=' + fileId + '&s=tcdn', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': embedUrl,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
          }
        });

        const sources = await sourcesRes.json();
        if (!sources.sources || !sources.sources.file) {
          return new Response(JSON.stringify({
            error: 'No source found',
            raw: sources,
            fileId: fileId
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const sourceUrl = sources.sources.file;
        const proxied = 'https://' + url.hostname + '/proxy?url=' + encodeURIComponent(sourceUrl);

        return new Response(JSON.stringify({
          ok: true,
          source: sourceUrl,
          proxied: proxied,
          fileId: fileId,
          streamId: streamId
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    if (url.pathname === '/raw') {
      const targetUrl = decodeURIComponent(url.searchParams.get('url') || '');
      if (!targetUrl) return new Response('Missing url', { status: 400 });
      const res = await fetch(targetUrl, {
        headers: {
          'Origin': 'https://megaplay.buzz',
          'Referer': 'https://megaplay.buzz/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0'
        }
      });
      const body = await res.text();
      return new Response(body, {
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname === '/proxy') {
      const targetUrl = decodeURIComponent(url.searchParams.get('url') || '');
      if (!targetUrl) return new Response('Missing url', { status: 400 });

      if (!targetUrl.includes('shiora.site') && !targetUrl.includes('megaplay.buzz') && !targetUrl.includes('megap.')) {
        return new Response('Domain not allowed: ' + targetUrl.substring(0, 100), { status: 403 });
      }

      const proxyRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://megaplay.buzz',
          'Referer': 'https://megaplay.buzz/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        }
      });

      const isPlaylist = targetUrl.includes('.m3u8') ||
                         (proxyRes.headers.get('content-type') || '').includes('mpegurl');

      if (isPlaylist) {
        let body = await proxyRes.text();
        const proxyBase = 'https://' + url.hostname;

        const cdnHostMatch = targetUrl.match(/https?:\/\/([a-zA-Z0-9\-\.]+shiora\.site)/);
        const cdnBase = cdnHostMatch ? 'https://' + cdnHostMatch[1] : '';

        // Rewrite absolute shiora URLs
        body = body.replace(
          /https?:\/\/[a-zA-Z0-9\-\.]+shiora\.site\/[^\s\n]+/g,
          function(match) { return proxyBase + '/proxy?url=' + encodeURIComponent(match); }
        );

        // Rewrite relative URLs (both /absolute and relative.m3u8)
        body = body.replace(
          /^([^#\s][^\s\n]+\.m3u8[^\s\n]*)/gm,
          function(match) {
            var absolute = match.startsWith('http') ? match : (cdnBase ? cdnBase + '/' + match : match);
            return proxyBase + '/proxy?url=' + encodeURIComponent(absolute);
          }
        );

        // Rewrite /absolute paths
        if (cdnBase) {
          body = body.replace(
            /^(\/[^\s\n]+)/gm,
            function(match) { return proxyBase + '/proxy?url=' + encodeURIComponent(cdnBase + match); }
          );
        }

        return new Response(body, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const buffer = await proxyRes.arrayBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': proxyRes.headers.get('content-type') || 'video/mp2t',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};