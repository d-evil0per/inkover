import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = normalizeSiteUrl(env.INKOVER_SITE_URL || "https://d-evil0per.github.io/inkover");
  const customDomain = (env.INKOVER_CUSTOM_DOMAIN || "").trim();
  const ogImageUrl = `${siteUrl}/og-card.svg`;
  const iconSvg = readFileSync(resolve(__dirname, "../assets/icon.svg"), "utf8");

  return {
    root: __dirname,
    base: "./",
    plugins: [
      {
        name: "inkover-site-seo",
        transformIndexHtml(html: string) {
          return html
            .replaceAll("__SITE_URL__", siteUrl)
            .replaceAll("__OG_IMAGE_URL__", ogImageUrl);
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "robots.txt",
            source: `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
          });

          this.emitFile({
            type: "asset",
            fileName: "sitemap.xml",
            source: [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
              "  <url>",
              `    <loc>${siteUrl}/</loc>`,
              "    <changefreq>weekly</changefreq>",
              "    <priority>1.0</priority>",
              "  </url>",
              "</urlset>",
            ].join("\n"),
          });

          this.emitFile({
            type: "asset",
            fileName: "site.webmanifest",
            source: JSON.stringify(
              {
                name: "InkOver",
                short_name: "InkOver",
                description: "Desktop annotation tool for demos, reviews, support sessions, and live walkthroughs.",
                start_url: "./",
                scope: "./",
                display: "standalone",
                background_color: "#f4efe7",
                theme_color: "#eb5e28",
                icons: [
                  {
                    src: "favicon.svg",
                    type: "image/svg+xml",
                    sizes: "any",
                  },
                ],
              },
              null,
              2,
            ),
          });

          this.emitFile({
            type: "asset",
            fileName: "favicon.svg",
            source: iconSvg,
          });

          if (customDomain) {
            this.emitFile({
              type: "asset",
              fileName: "CNAME",
              source: `${customDomain}\n`,
            });
          }
        },
      },
    ],
    build: {
      outDir: resolve(__dirname, "../dist/site"),
      emptyOutDir: true,
    },
    server: {
      port: 4173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});