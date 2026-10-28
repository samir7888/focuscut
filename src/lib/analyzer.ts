/**
 * Client-side page analyzer.
 * In production this is backed by /api/analyze (Cloudflare Pages Function).
 * In development (or when the Function is unavailable), we fetch via the
 * allorigins.win CORS proxy and parse the HTML ourselves – same logic as the
 * Function, so results are consistent.
 */
import type { PageAnalysis } from '../types/project';

function parseHtml(html: string, targetUrl: string): PageAnalysis {
  const parsed = new URL(targetUrl);

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const themeMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
  const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  const title = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || parsed.hostname;
  const description = descMatch?.[1]?.trim();

  // Colors from hex codes in HTML
  const colorMatches = html.match(/#[0-9a-fA-F]{3,6}/g) || [];
  const colors = Array.from(new Set(colorMatches)).slice(0, 8);
  if (themeMatch?.[1]) colors.unshift(themeMatch[1]);

  // Headings
  const headings: PageAnalysis['headings'] = [];
  const h1s = html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [];
  h1s.slice(0, 2).forEach((h) => {
    const m = h.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (m) headings.push({ level: 1, text: m[1].replace(/<[^>]+>/g, '').trim() });
  });
  const h2s = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
  h2s.slice(0, 4).forEach((h) => {
    const m = h.match(/<h2[^>]*>([^<]+)<\/h2>/i);
    if (m) headings.push({ level: 2, text: m[1].replace(/<[^>]+>/g, '').trim() });
  });
  const h3s = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];
  h3s.slice(0, 3).forEach((h) => {
    const m = h.match(/<h3[^>]*>([^<]+)<\/h3>/i);
    if (m) headings.push({ level: 3, text: m[1].replace(/<[^>]+>/g, '').trim() });
  });

  // Features from list items
  const features: PageAnalysis['features'] = [];
  const liMatches = html.match(/<li[^>]*>([^<]{10,80})<\/li>/gi) || [];
  liMatches.slice(0, 8).forEach((li) => {
    const m = li.match(/<li[^>]*>([^<]+)<\/li>/i);
    if (m) {
      const txt = m[1].replace(/<[^>]+>/g, '').trim();
      if (txt) features.push({ title: txt });
    }
  });

  // CTAs from buttons and links
  const ctas: PageAnalysis['ctas'] = [];
  const buttonMatches = html.match(/<(button|a)[^>]+>([^<]{3,40})<\/(button|a)>/gi) || [];
  buttonMatches.slice(0, 6).forEach((btn) => {
    const m = btn.match(/<(button|a)[^>]+>([^<]+)<\/(button|a)>/i);
    if (m) {
      const txt = m[2].replace(/<[^>]+>/g, '').trim();
      if (txt && txt.length < 40) ctas.push({ text: txt });
    }
  });

  // Stats: patterns like "10k users", "99% uptime", "$0/mo"
  const statsRaw = html.match(/\b(\d[\d,kKmMbB.%$€£¥]+)\s*(<[^>]+>)*\s*([A-Za-z][A-Za-z\s]{2,30})/g) || [];
  const stats: PageAnalysis['stats'] = statsRaw.slice(0, 4).map((s) => {
    const clean = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = clean.split(' ');
    return { value: parts[0], label: parts.slice(1).join(' ') };
  });

  // Forms & Inputs: inputs, textareas
  const inputMatches = html.match(/<(input|textarea)[^>]+>/gi) || [];
  const fields: { label?: string; type: string }[] = [];
  inputMatches.slice(0, 4).forEach((inp) => {
    const typeMatch = inp.match(/type=["']([^"']+)["']/i);
    const placeholderMatch = inp.match(/placeholder=["']([^"']+)["']/i);
    const nameMatch = inp.match(/name=["']([^"']+)["']/i);
    const type = typeMatch?.[1] || 'text';
    if (type !== 'hidden' && type !== 'submit') {
      fields.push({
        label: placeholderMatch?.[1] || nameMatch?.[1] || 'Input Field',
        type,
      });
    }
  });
  const forms: PageAnalysis['forms'] = fields.length > 0 ? [{ label: 'Main Form', fields }] : [];

  const summary = {
    tagline: description || title,
    bullets: features.slice(0, 3).map((f) => f.title),
    script: features.slice(0, 3).map((f) => `Show: ${f.title}`),
  };

  return {
    url: targetUrl,
    title,
    description,
    favicon: ogImgMatch?.[1],
    brand: { colors: colors.slice(0, 6), fonts: ['Inter', 'system-ui'] },
    headings,
    features,
    ctas,
    forms,
    stats,
    summary,
  };
}

export async function analyzePage(targetUrl: string): Promise<PageAnalysis> {
  // 1. Try the Cloudflare Pages Function first (works in production / wrangler dev)
  // In local Vite dev mode this returns a 404 HTML page, so we detect that and fall through.
  try {
    const res = await fetch(`/api/analyze?url=${encodeURIComponent(targetUrl)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const ct = res.headers.get('content-type') || '';
    // Only treat as success if we got JSON back
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      return data as PageAnalysis;
    }
    // Non-JSON 404 → Vite is serving its own 404 HTML. Fall through to client-side path.
    if (!res.ok && res.status !== 404) {
      // It's a real server error (5xx etc) — try to parse and throw
      if (ct.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `Server error ${res.status}`);
      }
      throw new Error(`Server error ${res.status}`);
    }
    // 404 or ok-but-not-json: fall through to client-side path
  } catch (e: any) {
    // Only propagate real errors, not fetch/network failures (which mean fallback is needed)
    if (e?.name === 'AbortError') throw new Error('Analysis timed out. Try again.');
    if (e?.message && !e.message.includes('fetch') && !e.message.includes('Failed to fetch') && !e.message.includes('NetworkError')) {
      // Real error from our code above – re-throw
      throw e;
    }
    // Network error: function not available, fall through to client-side
  }

  // 2. Client-side fallback: use allorigins CORS proxy to fetch the HTML
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Could not fetch page (${res.status}). Check the URL and try again.`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    // allorigins sometimes drops the content-type; try parsing anyway
    console.warn('Unexpected content-type:', contentType);
  }

  const html = await res.text();
  if (html.length > 4_000_000) throw new Error('Page is too large to analyze.');

  return parseHtml(html, targetUrl);
}
