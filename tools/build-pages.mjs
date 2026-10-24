// generates the landing pages (site/<slug>/index.html) and site/sitemap.xml from tools/pages.mjs
// run: node tools/build-pages.mjs   (the generated files are committed, Docker needs no node)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHONE, vehicles, places } from './pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const home = readFileSync(join(root, 'index.html'), 'utf8');
const css = home.match(/<style>([\s\S]*?)<\/style>/)[1];
const headScripts = home.slice(home.indexOf('</style>') + 8, home.indexOf('</head>')).trim(); // umami + lazy replay loader
const revealJs = home.match(/<script>\n\(function\(\)\{var els=[\s\S]*?<\/script>/)[0];
const phoneSvg = home.match(/<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6\.6[\s\S]*?<\/svg>/)[0];
const waSvg = home.match(/<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10[\s\S]*?<\/svg>/)[0];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const all = new Map([...vehicles, ...places].map((p) => [p.slug, p]));
const label = (p) => (p.name ? `חילוץ שטח ב${p.name}` : p.title);
const linkText = (p) => (p.name ? p.name : p.title);

const extraCss = `
.hero.sub{padding:20px 0 40px}.hero.sub .brand{margin-bottom:12px}
.crumbs{font-size:.9rem;opacity:.9;margin-bottom:14px}.crumbs a{text-decoration:underline}
.links{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin-top:14px}
.links li{margin:0}.links a{display:inline-block;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px;text-decoration:none;color:var(--dark);font-weight:600}
.card h3 a{text-decoration:none}
.fnav{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:center;list-style:none;padding:0;margin:0 0 14px}.fnav li{margin:0}.fnav a{text-decoration:underline}
.chips.areas a{color:inherit;text-decoration:none}
`;

const waHref = (t) => `https://wa.me/${PHONE.intl}?text=${encodeURIComponent(t)}`;

function layout({ slug, title, desc, h1, sub, lead, crumb, ld, body, waText }) {
  const url = `__DOMAIN__/${slug}/`;
  const nav = [...places.map((p) => [p.slug, linkText(p)]), ...vehicles.map((v) => [v.slug, v.title])];
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#1f3a2b">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="__DOMAIN__/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="__DOMAIN__/og-image.jpg">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@graph': ld })}
</script>
<style>${css}${extraCss}</style>
${headScripts}
</head>
<body>
<header class="hero sub">
<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb"><a href="/">כננת – חילוצי שטח 4X4</a> › ${esc(crumb)}</nav>
<h1>${esc(h1)}<span class="sub">${esc(sub)}</span></h1>
<p class="lead">${esc(lead)}</p>
<div class="cta">
<a data-umami-event="call-click" class="btn call" href="tel:+${PHONE.intl}">${phoneSvg}${PHONE.display}</a>
<a data-umami-event="whatsapp-click" class="btn wa" href="${waHref(waText)}" rel="noopener">${waSvg}ווטסאפ</a>
</div>
<ul class="chips"><li>24/7 כולל שבתות</li><li>מחיר לפני יציאה</li><li>ציוד חילוץ מתאים</li></ul>
</div>
</header>
<main>
${body}
</main>
<footer>
<ul class="fnav"><li><a href="/">עמוד הבית</a></li>${nav.map(([s, t]) => `<li><a href="/${s}/">${esc(t)}</a></li>`).join('')}</ul>
© כננת – חילוצי שטח 4X4 · חילוץ שטח 24/7 · מחיר לפני יציאה<br>האתר פותח על ידי <a href="mailto:dima.zev@gmail.com">dima.zev@gmail.com</a>
</footer>
<div class="bar">
<a data-umami-event="call-click" class="btn call" href="tel:+${PHONE.intl}">התקשרו</a>
<a data-umami-event="whatsapp-click" class="btn wa" href="${waHref(waText)}" rel="noopener">ווטסאפ</a>
</div>
${revealJs}
</body>
</html>
`;
}

const cards = (list) => `<div class="grid">\n${list.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('\n')}\n</div>`;
const faqHtml = (faq) => faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n');
const linkList = (slugs) => `<ul class="links">${slugs.map((s) => `<li><a href="/${s}/">${esc(label(all.get(s)))}</a></li>`).join('')}</ul>`;
const contact = (t) => `<section id="contact"><div class="contact">
<h2>${esc(t)}</h2>
<a data-umami-event="call-click" class="num" href="tel:+${PHONE.intl}">${PHONE.display}</a>
<div class="cta">
<a data-umami-event="call-click" class="btn call" href="tel:+${PHONE.intl}">חייגו עכשיו</a>
<a data-umami-event="whatsapp-click" class="btn wa" href="https://wa.me/${PHONE.intl}" rel="noopener">שלחו מיקום בווטסאפ</a>
</div></div></section>`;

const steps = `<section id="order"><h2>איך מזמינים</h2><div class="grid">
<div class="card"><h3>1. שולחים מיקום</h3><p>בווטסאפ שולחים Pin. זה עובד גם כשאין כתובת.</p></div>
<div class="card"><h3>2. מוסיפים פרטים</h3><p>סוג הכלי, מה קרה, ותמונה אם אפשר.</p></div>
<div class="card"><h3>3. מקבלים מחיר</h3><p>המחיר נמסר לפני שיוצאים אליכם. מאשרים ורק אז יוצאים.</p></div>
<div class="card"><h3>4. יוצאים אליכם</h3><p>מגיעים בכל שעה, גם בשבת ובחג, עם ציוד מתאים.</p></div>
</div></section>`;

const vehicleCards = `<div class="grid">${vehicles.map((v) => `<div class="card"><h3><a href="/${v.slug}/">${esc(v.title)}</a></h3><p>${esc(v.sub)}.</p></div>`).join('')}</div>`;

const ldBase = (slug, name, crumbName, extra = {}) => [
  { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'כננת – חילוצי שטח 4X4', item: '__DOMAIN__/' }, { '@type': 'ListItem', position: 2, name: crumbName, item: `__DOMAIN__/${slug}/` }] },
  { '@type': 'Service', serviceType: 'חילוץ שטח', name, provider: { '@id': '__DOMAIN__/#business' }, availableChannel: { '@type': 'ServiceChannel', servicePhone: `+${PHONE.intl}` }, ...extra }
];
const ldFaq = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });

const pages = [];

for (const p of places) {
  const n = p.name, i = p.in;
  const faq = [
    [`האם אתם מגיעים ל${n}?`, `כן, אנחנו זמינים ל${n} ולסביבה 24/7, כולל שבתות וחגים. שלחו מיקום בווטסאפ ונאשר איך מגיעים הכי קרוב לכלי.`],
    [`כמה עולה חילוץ שטח ${i}?`, `המחיר תלוי במיקום, בסוג הכלי ובמורכבות החילוץ. מתקשרים או שולחים מיקום ותמונה, והמחיר נמסר לפני שיוצאים אליכם.`],
    p.faq,
    ['אילו כלים אתם מחלצים?', 'ג\'יפים ורכבי 4X4, טרקטורונים, רייזרים ואופנועי שטח, וגם רכבים פרטיים וטנדרים שנתקעו בחול או בבוץ.']
  ];
  const title = `חילוצי שטח ${i} 24/7 | כננת – ${PHONE.display}`;
  const desc = `חילוצי שטח ${i} ובסביבה, חילוץ שטח 24/7: ג'יפים, 4X4, טרקטורונים, רייזרים ואופנועי שטח שנתקעו בחול או בבוץ. המחיר נמסר לפני שיוצאים. ${PHONE.display}.`;
  const body = `<div class="wrap"><section id="local">
<h2>חילוץ שטח ${esc(i)}</h2>
<p>${esc(p.intro)}</p>
<p>שירות החילוץ פעיל 24 שעות ביממה, 7 ימים בשבוע. שולחים מיקום ותמונה בווטסאפ, מקבלים מחיר לפני שיוצאים, ואנחנו מגיעים עם ציוד חילוץ שמתאים לכלי ולשטח.</p>
<h3 style="margin-top:18px">איפה נתקעים ${esc(i)}</h3>
<ul class="chips areas">${p.spots.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
</section>
<section id="services"><h2>מה אנחנו מחלצים ${esc(i)}</h2>${vehicleCards}
<p style="margin-top:14px">בחורף, אחרי גשם, שבילי עפר ושדות הופכים לבוץ. בקיץ, חול רך ושבילי חוף הם הסיבה הנפוצה. בשני המקרים חילוץ נכון חוסך נזק לכלי.</p>
${p.place ? '<p>נסיעה בשמורות טבע ובשטחים מוגנים מותרת רק בנתיבים המסומנים. אנחנו לא מעודדים נסיעה מחוץ להם.</p>' : ''}
</section>
${steps}
<section id="faq"><h2>שאלות נפוצות על חילוץ שטח ${esc(i)}</h2>
${faqHtml(faq)}
</section>
<section id="near"><h2>חילוץ שטח באזורים קרובים</h2>${linkList(p.nearby)}
<p style="margin-top:14px">לפי סוג כלי: ${vehicles.map((v) => `<a href="/${v.slug}/">${esc(v.title)}</a>`).join(' · ')}</p></section>
${contact(`תקועים ${i}? אנחנו זמינים 24/7`)}
</div>`;
  pages.push({
    slug: p.slug, title, desc, h1: `חילוצי שטח ${i}`, sub: '24/7 · מחיר לפני יציאה',
    lead: `ג'יפים, 4X4, טרקטורונים, רייזרים ואופנועי שטח שנתקעו ${i} ובסביבה. שלחו מיקום בווטסאפ, והמחיר נמסר לפני שיוצאים אליכם.`,
    crumb: `חילוץ שטח ${i}`, waText: `שלום, צריך חילוץ שטח ${i}. אשמח לשלוח מיקום`,
    ld: [...ldBase(p.slug, `חילוץ שטח ${i}`, `חילוץ שטח ${i}`, { areaServed: { '@type': p.place ? 'Place' : 'City', name: n }, description: desc }), ldFaq(faq)],
    body
  });
}

for (const v of vehicles) {
  const title = `${v.title} 24/7 – ${PHONE.display}`;
  const body = `<div class="wrap"><section id="situations">
<h2>מתי קוראים ל${esc(v.title)}</h2>
${cards(v.cards)}
</section>
<section id="about"><h2>איך מתבצע ${esc(v.title)}</h2>${v.body.map((t) => `<p>${esc(t)}</p>`).join('\n')}</section>
${steps}
<section id="tips"><h2>נתקעתם? מה עושים עד שמגיעים</h2><ol>${v.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>
<section id="faq"><h2>שאלות נפוצות</h2>
${faqHtml(v.faq)}
</section>
<section id="areas"><h2>חילוץ שטח לפי אזור</h2>${linkList(places.map((p) => p.slug))}
<p style="margin-top:14px">סוגי כלים נוספים: ${v.related.map((s) => `<a href="/${s}/">${esc(all.get(s).title)}</a>`).join(' · ')}</p></section>
${contact(`כלי תקוע? אנחנו זמינים 24/7`)}
</div>`;
  pages.push({
    slug: v.slug, title, desc: v.desc, h1: v.h1, sub: v.sub, lead: v.lead, crumb: v.title,
    waText: `שלום, צריך ${v.title}. אשמח לשלוח מיקום`,
    ld: [...ldBase(v.slug, v.title, v.title, { areaServed: { '@type': 'Country', name: 'Israel' }, description: v.desc }), ldFaq(v.faq)],
    body
  });
}

for (const pg of pages) {
  mkdirSync(join(root, pg.slug), { recursive: true });
  writeFileSync(join(root, pg.slug, 'index.html'), layout(pg));
}

const urls = [
  `  <url>\n    <loc>__DOMAIN__/</loc>\n    <lastmod>__LASTMOD__</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n    <image:image>\n      <image:loc>__DOMAIN__/hilutz-shetach-silverado-razer-1024.webp</image:loc>\n      <image:title>חילוץ שטח 24/7 – ג'יפ סילברדו מחלץ רייזר מהחול</image:title>\n    </image:image>\n  </url>`,
  ...pages.map((p) => `  <url>\n    <loc>__DOMAIN__/${p.slug}/</loc>\n    <lastmod>__LASTMOD__</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${vehicles.some((v) => v.slug === p.slug) ? '0.8' : '0.7'}</priority>\n  </url>`)
];
writeFileSync(join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`${pages.length} pages + sitemap`);
