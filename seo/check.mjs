// Daily SEO check: how Google sees the site (Search Console), speed (PageSpeed Insights),
// on-page SEO basics, optional SERP positions. Writes logs/seo/ and prints a summary.
//   node seo/check.mjs            (reads ../.env; see README "SEO monitoring")
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, 'logs', 'seo');
mkdirSync(logDir, { recursive: true });

// ---- config: .env (git-ignored) + process env ----
const env = { ...process.env };
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const site = (env.DOMAIN ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(site)) {
  console.error('DOMAIN is not set in .env');
  process.exit(1);
}
const host = new URL(site).hostname;
const queries = (env.SEO_QUERIES ?? 'חילוץ שטח,חילוצי שטח,חילוץ ג׳יפ,חילוץ רייזר,חילוץ מחול,חילוץ 4x4').split(',').map((q) => q.trim()).filter(Boolean);
// endpoints can be overridden (tests); defaults are Google's
const PSI_URL = env.PSI_ENDPOINT ?? 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TOKEN_URL = env.GSC_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const GSC_BASE = env.GSC_API_BASE ?? 'https://www.googleapis.com/webmasters/v3';
const INSPECT_URL = env.GSC_INSPECT_URL ?? 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const today = new Date().toISOString().slice(0, 10);
const report = { date: today, site, startedAt: new Date().toISOString(), onPage: null, psi: {}, searchConsole: null, serp: null, errors: [] };
const fail = (where, err) => { report.errors.push(`${where}: ${err?.message ?? err}`); };

const getJson = async (url, init) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), ...init });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 && url.includes('pagespeedonline') && !url.includes('key=') ? ' (set PSI_API_KEY in .env: the shared anonymous quota is used up)' : ''} ${typeof body === 'string' ? body.slice(0, 200) : body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  return body;
};

// ---- 1. on-page checks of the live site ----
async function onPage() {
  const t0 = Date.now();
  const res = await fetch(`${site}/`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; seo-check)' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const html = await res.text();
  const ttfbMs = Date.now() - t0;
  const pick = (re) => (html.match(re)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const attr = (tag, name) => tag?.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find((x) => x !== undefined) ?? '';
  const description = attr(html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0], 'content').trim();
  const canonical = attr(html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0], 'href').trim();
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => { try { JSON.parse(m[1]); return true; } catch { return false; } });
  const robots = await fetch(`${site}/robots.txt`).then(async (r) => ({ status: r.status, text: await r.text() })).catch(() => ({ status: 0, text: '' }));
  const sitemap = await fetch(`${site}/sitemap.xml`).then(async (r) => ({ status: r.status, text: await r.text() })).catch(() => ({ status: 0, text: '' }));
  const issues = [];
  if (res.status !== 200) issues.push(`home returned ${res.status}`);
  if (title.length < 20 || title.length > 70) issues.push(`title length ${title.length} (aim 20-70)`);
  if (description.length < 70 || description.length > 170) issues.push(`description length ${description.length} (aim 70-170)`);
  if (h1s.length !== 1) issues.push(`${h1s.length} H1 tags (want 1)`);
  if (!canonical.startsWith(site)) issues.push(`canonical "${canonical}" does not match DOMAIN`);
  if (/example\.co\.il/.test(html)) issues.push('placeholder domain still present in the HTML');
  if (imgs.some((i) => !/\balt=["'][^"']+["']/.test(i))) issues.push('image without alt text');
  if (!ld.length || ld.includes(false)) issues.push('structured data missing or invalid JSON');
  if (robots.status !== 200) issues.push(`robots.txt returned ${robots.status}`);
  else if (/Disallow:\s*\/\s*$/m.test(robots.text)) issues.push('robots.txt blocks the whole site');
  if (sitemap.status !== 200 || !sitemap.text.includes(host)) issues.push('sitemap.xml missing or has the wrong domain');
  return { status: res.status, finalUrl: res.url, ttfbMs, htmlBytes: Buffer.byteLength(html), title, titleLen: title.length, description, descriptionLen: description.length, canonical, h1: h1s, structuredData: ld.length, robotsStatus: robots.status, sitemapStatus: sitemap.status, issues };
}

// ---- 1b. every page listed in sitemap.xml: reachable, own title / canonical / single H1, not a copy of another page ----
async function subPages() {
  const sm = await fetch(`${site}/sitemap.xml`).then((r) => r.text()).catch(() => '');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.replace(/\/$/, '') !== site);
  const rows = [], titles = new Map(), issues = [];
  for (const u of urls) {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; seo-check)' }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    const html = r ? await r.text() : '';
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)/i)?.[1] ?? '';
    const h1 = (html.match(/<h1\b/gi) ?? []).length;
    rows.push({ url: u, status: r?.status ?? 0, title, h1 });
    if (r?.status !== 200) issues.push(`${u} returned ${r?.status ?? 'no response'}`);
    else {
      if (canonical !== u) issues.push(`${u} canonical is "${canonical}"`);
      if (h1 !== 1) issues.push(`${u} has ${h1} H1 tags`);
      if (title.length < 20 || title.length > 70) issues.push(`${u} title length ${title.length}`);
      if (titles.has(title)) issues.push(`${u} has the same title as ${titles.get(title)}`);
      titles.set(title, u);
    }
  }
  return { count: urls.length, issues, rows };
}

// ---- 2. PageSpeed Insights (Lighthouse + real-user Core Web Vitals) ----
async function psi(strategy) {
  const q = new URLSearchParams({ url: `${site}/`, strategy });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  if (env.PSI_API_KEY) q.set('key', env.PSI_API_KEY);
  const j = await getJson(`${PSI_URL}?${q}`);
  const c = j.lighthouseResult.categories, a = j.lighthouseResult.audits;
  const field = j.loadingExperience?.metrics ?? {};
  return {
    performance: Math.round(c.performance.score * 100), seo: Math.round(c.seo.score * 100), accessibility: Math.round(c.accessibility.score * 100), bestPractices: Math.round(c['best-practices'].score * 100),
    lcpMs: Math.round(a['largest-contentful-paint'].numericValue), cls: +a['cumulative-layout-shift'].numericValue.toFixed(3), tbtMs: Math.round(a['total-blocking-time'].numericValue),
    field: Object.fromEntries(Object.entries(field).map(([k, v]) => [k, { p75: v.percentile, rating: v.category }])),
    failedAudits: Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && !['informative', 'manual', 'notApplicable'].includes(x.scoreDisplayMode)).map((x) => x.id).slice(0, 15)
  };
}

// ---- 3. Search Console (service account) ----
async function gscToken(key) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key, 'base64url');
  const j = await getJson(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  return j.access_token;
}
async function searchConsole() {
  const keyFile = env.GSC_KEY_FILE;
  if (!keyFile || !existsSync(join(root, keyFile) ) && !existsSync(keyFile)) return { skipped: 'set GSC_KEY_FILE (service account JSON) and GSC_SITE in .env' };
  const key = JSON.parse(readFileSync(existsSync(keyFile) ? keyFile : join(root, keyFile), 'utf8'));
  const siteUrl = env.GSC_SITE || `${site}/`;
  const token = await gscToken(key);
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const day = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const range = { startDate: day(30), endDate: day(3) }; // Search Console data lags ~2-3 days
  const q = (body) => getJson(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', headers: auth, body: JSON.stringify({ ...range, ...body }) });
  const [total, byQuery, byDay] = await Promise.all([q({}), q({ dimensions: ['query'], rowLimit: 50 }), q({ dimensions: ['date'], rowLimit: 40 })]);
  const t = total.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let inspection = null;
  try {
    const i = await getJson(INSPECT_URL, { method: 'POST', headers: auth, body: JSON.stringify({ inspectionUrl: `${site}/`, siteUrl, languageCode: 'he' }) });
    const r = i.inspectionResult?.indexStatusResult ?? {};
    inspection = { verdict: r.verdict, coverage: r.coverageState, indexing: r.indexingState, robotsTxt: r.robotsTxtState, pageFetch: r.pageFetchState, lastCrawl: r.lastCrawlTime, crawledAs: r.crawledAs, googleCanonical: r.googleCanonical, userCanonical: r.userCanonical, sitemaps: r.sitemap };
  } catch (e) { fail('urlInspection', e); }
  let sitemaps = null;
  try { sitemaps = (await getJson(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`, { headers: auth })).sitemap?.map((s) => ({ path: s.path, lastDownloaded: s.lastDownloaded, errors: s.errors, warnings: s.warnings })) ?? []; } catch (e) { fail('sitemaps', e); }
  return { range, clicks: t.clicks, impressions: t.impressions, ctr: +(t.ctr * 100).toFixed(2), avgPosition: +t.position.toFixed(1), inspection, sitemaps,
    queries: (byQuery.rows ?? []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1) })),
    daily: (byDay.rows ?? []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(1) })) };
}

// ---- 4. optional: today's Google position for your keywords (SerpAPI, paid) ----
async function serp() {
  if (!env.SERPAPI_KEY) return { skipped: 'set SERPAPI_KEY to track keyword positions (optional, paid)' };
  const out = [];
  for (const q of queries) {
    try {
      const j = await getJson(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google', q, google_domain: 'google.co.il', gl: 'il', hl: 'iw', num: '100', api_key: env.SERPAPI_KEY })}`);
      const org = j.organic_results ?? [];
      const idx = org.findIndex((r) => (r.link ?? '').includes(host));
      out.push({ query: q, position: idx >= 0 ? org[idx].position ?? idx + 1 : null, top3: org.slice(0, 3).map((r) => new URL(r.link).hostname) });
    } catch (e) { out.push({ query: q, error: e.message }); }
  }
  return out;
}

const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(name, e); return null; } };
report.onPage = await step('onPage', onPage);
report.subPages = await step('subPages', subPages);
report.psi.mobile = await step('psi-mobile', () => psi('mobile'));
report.psi.desktop = await step('psi-desktop', () => psi('desktop'));
report.searchConsole = await step('searchConsole', searchConsole);
report.serp = await step('serp', serp);
report.finishedAt = new Date().toISOString();

// ---- logs ----
writeFileSync(join(logDir, `${today}.json`), JSON.stringify(report, null, 2));
// one row per day: a manual re-run replaces today's rows instead of duplicating them
const writeDay = (file, header, rows) => {
  const keep = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l && l !== header.trim() && !l.startsWith(`"${today}"`)) : [];
  writeFileSync(file, [header.trim(), ...keep, ...rows].join('\n') + '\n');
};
const csv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const histFile = join(logDir, 'history.csv');
const head = 'date,http,ttfb_ms,onpage_issues,psi_mobile_perf,psi_mobile_seo,psi_mobile_a11y,psi_mobile_bp,lcp_ms,cls,tbt_ms,gsc_clicks_30d,gsc_impressions_30d,gsc_ctr_pct,gsc_avg_position,index_verdict,last_crawl,errors\n';
const o = report.onPage, m = report.psi.mobile, g = report.searchConsole?.skipped ? null : report.searchConsole;
writeDay(histFile, head, [[today, o?.status, o?.ttfbMs, o?.issues.length, m?.performance, m?.seo, m?.accessibility, m?.bestPractices, m?.lcpMs, m?.cls, m?.tbtMs, g?.clicks, g?.impressions, g?.ctr, g?.avgPosition, g?.inspection?.verdict, g?.inspection?.lastCrawl, report.errors.length].map(csv).join(',')]);
if (g?.queries?.length) {
  const qFile = join(logDir, 'queries.csv');
  writeDay(qFile, 'date,query,clicks,impressions,ctr_pct,position', g.queries.map((r) => [today, r.query, r.clicks, r.impressions, r.ctr, r.position].map(csv).join(',')));
}
if (Array.isArray(report.serp)) {
  const sFile = join(logDir, 'serp.csv');
  writeDay(sFile, 'date,query,position,top3', report.serp.map((r) => [today, r.query, r.position ?? 'not in top 100', (r.top3 ?? []).join(' | ')].map(csv).join(',')));
}

// ---- summary (this is what cron mails / logs) ----
const L = [];
L.push(`SEO check ${today}  ${site}`);
if (o) {
  L.push(`on-page: HTTP ${o.status}, ${o.ttfbMs} ms, title ${o.titleLen} chars, description ${o.descriptionLen} chars, H1 x${o.h1.length}, robots ${o.robotsStatus}, sitemap ${o.sitemapStatus}`);
  L.push(o.issues.length ? `  issues: ${o.issues.join('; ')}` : '  issues: none');
}
if (report.subPages) L.push(`landing pages: ${report.subPages.count} in sitemap, ${report.subPages.issues.length ? 'issues: ' + report.subPages.issues.join('; ') : 'all OK'}`);
for (const s of ['mobile', 'desktop']) {
  const p = report.psi[s];
  if (p) L.push(`PageSpeed ${s}: perf ${p.performance}, seo ${p.seo}, a11y ${p.accessibility}, best-practices ${p.bestPractices}, LCP ${p.lcpMs} ms, CLS ${p.cls}, TBT ${p.tbtMs} ms${p.failedAudits.length ? `  (to fix: ${p.failedAudits.join(', ')})` : ''}`);
}
if (report.searchConsole?.skipped) L.push(`Search Console: skipped (${report.searchConsole.skipped})`);
else if (g) {
  L.push(`Google (30d to ${g.range.endDate}): ${g.clicks} clicks, ${g.impressions} impressions, CTR ${g.ctr}%, avg position ${g.avgPosition}`);
  if (g.inspection) L.push(`  index status: ${g.inspection.verdict} / ${g.inspection.coverage}; last crawl ${g.inspection.lastCrawl ?? 'never'}; Google canonical ${g.inspection.googleCanonical}`);
  for (const r of g.queries.slice(0, 10)) L.push(`  "${r.query}": pos ${r.position}, ${r.impressions} impr, ${r.clicks} clicks`);
}
if (Array.isArray(report.serp)) for (const r of report.serp) L.push(`SERP "${r.query}": ${r.error ? `error ${r.error}` : r.position ? `#${r.position}` : 'not in top 100'}`);
if (report.errors.length) L.push(`errors: ${report.errors.join(' | ')}`);
L.push(`logs: ${logDir}`);
console.log(L.join('\n'));
