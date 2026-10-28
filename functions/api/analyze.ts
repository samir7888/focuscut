export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');
  
  if (!target) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400 });
  }
  
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'invalid protocol' }), { status: 400 });
    }
    const hostname = parsed.hostname;
    // Block private/loopback/link-local/metadata
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.20.') ||
      hostname.startsWith('172.21.') ||
      hostname.startsWith('172.22.') ||
      hostname.startsWith('172.23.') ||
      hostname.startsWith('169.254.') ||
      hostname === '169.254.169.254'
    ) {
      return new Response(JSON.stringify({ error: 'private host blocked' }), { status: 403 });
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(target, { 
      signal: controller.signal,
      headers: { 'User-Agent': 'Focuscut-Analyzer/1.0' },
      redirect: 'manual'
    });
    clearTimeout(timeout);
    
    if (res.status >= 300 && res.status < 400) {
      return new Response(JSON.stringify({ error: 'redirects not followed blindly' }), { status: 400 });
    }
    
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return new Response(JSON.stringify({ error: 'content-type must be text/html' }), { status: 400 });
    }
    
    const text = await res.text();
    if (text.length > 2_000_000) {
      return new Response(JSON.stringify({ error: 'response too large' }), { status: 413 });
    }
    
    // Simple parse
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const h1Match = text.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const descMatch = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const themeMatch = text.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
    const title = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || parsed.hostname;
    const description = descMatch?.[1]?.trim();
    
    // Extract colors from inline styles and common patterns
    const colorMatches = text.match(/#[0-9a-fA-F]{3,6}/g) || [];
    const colors = Array.from(new Set(colorMatches)).slice(0, 8);
    if (themeMatch?.[1]) colors.unshift(themeMatch[1]);
    
    const headings = [];
    const h1s = text.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [];
    h1s.slice(0, 2).forEach(h => {
      const m = h.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (m) headings.push({ level: 1, text: m[1].replace(/<[^>]+>/g, '').trim() });
    });
    const h2s = text.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
    h2s.slice(0, 3).forEach(h => {
      const m = h.match(/<h2[^>]*>([^<]+)<\/h2>/i);
      if (m) headings.push({ level: 2, text: m[1].replace(/<[^>]+>/g, '').trim() });
    });
    
    const features = [];
    const liMatches = text.match(/<li[^>]*>([^<]{10,80})<\/li>/gi) || [];
    liMatches.slice(0, 5).forEach(li => {
      const m = li.match(/<li[^>]*>([^<]+)<\/li>/i);
      if (m) {
        const txt = m[1].replace(/<[^>]+>/g, '').trim();
        if (txt) features.push({ title: txt });
      }
    });
    
    const ctas = [];
    const buttonMatches = text.match(/<(button|a)[^>]+>([^<]{3,40})<\/(button|a)>/gi) || [];
    buttonMatches.slice(0, 4).forEach(btn => {
      const m = btn.match(/<(button|a)[^>]+>([^<]+)<\/(button|a)>/i);
      if (m) {
        const txt = m[2].replace(/<[^>]+>/g, '').trim();
        if (txt && txt.length < 40) ctas.push({ text: txt });
      }
    });
    
    return new Response(JSON.stringify({
      url: target,
      title,
      description,
      brand: { colors: colors.slice(0, 6), fonts: ['Inter', 'system-ui'] },
      headings,
      features,
      ctas,
      forms: [],
      stats: [],
      summary: { tagline: title, bullets: features.slice(0, 3).map(f => f.title), script: features.slice(0, 3).map(f => `Show: ${f.title}`) }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
