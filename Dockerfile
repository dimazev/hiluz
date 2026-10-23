FROM nginx:1.27-alpine
ARG DOMAIN=https://example.co.il
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
# the real domain goes into canonical / og:url / sitemap / JSON-LD
RUN sed -i "s#__DOMAIN__#${DOMAIN}#g; s#__LASTMOD__#$(date +%F)#g" $(find /usr/share/nginx/html -name "*.html" -o -name robots.txt -o -name sitemap.xml)
