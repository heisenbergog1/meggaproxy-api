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

        // Step 1: Load embed page to get file ID
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

        // Extract file ID from page title "File 36111 - MegaPlay"
        const fileIdMatch = html.match(/File (\d+) - MegaPlay/);
        if (!fileIdMatch) {
          return new Response(JSON.stringify({ 
            error: 'Could not extract file ID', 
            preview: html.substring(0, 500),
            embedUrl: embedUrl
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const fileId = fileIdMatch[1];

        // Step 2: Hit getSources with exact headers from HAR
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

        return new Response(JSON.stringify({
          ok: true,
          source: sources.sources.file,
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

    return new Response('Not found', { status: 404 });
  }
};