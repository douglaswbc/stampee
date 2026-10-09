import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../data/articles.data.js";

const configuredOrigin = process.env.VITE_APP_URL?.trim() || process.env.SITE_ORIGIN?.trim() || "https://stampee.co";
const SITE_ORIGIN = new URL(configuredOrigin).origin;
const OUTPUT_PATH = resolve(process.cwd(), "public", "sitemap.xml");
const ROBOTS_PATH = resolve(process.cwd(), "public", "robots.txt");

const staticRoutes = [
  { path: "/", lastmod: "2026-10-08", changefreq: "weekly", priority: "1.0" },
  { path: "/showcase", lastmod: "2026-03-03", changefreq: "weekly", priority: "0.8" },
  { path: "/articles", lastmod: "2026-03-03", changefreq: "weekly", priority: "0.8" },
  { path: "/privacy-policy", lastmod: "2026-03-03", changefreq: "monthly", priority: "0.5" },
  { path: "/cookie", lastmod: "2026-03-09", changefreq: "monthly", priority: "0.5" },
  { path: "/terms", lastmod: "2026-03-03", changefreq: "monthly", priority: "0.5" },
];

const formatDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid article date: ${value}`);
  }

  return parsed.toISOString().slice(0, 10);
};

const routes = [
  ...staticRoutes,
  ...articles.map((article) => ({
    path: article.href,
    lastmod: formatDate(article.publishedDate),
    changefreq: "monthly",
    priority: "0.7",
  })),
];

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map(
    (route) => [
      "  <url>",
      `    <loc>${SITE_ORIGIN}${route.path}</loc>`,
      `    <lastmod>${route.lastmod}</lastmod>`,
      `    <changefreq>${route.changefreq}</changefreq>`,
      `    <priority>${route.priority}</priority>`,
      "  </url>",
    ].join("\n")
  ),
  "</urlset>",
  "",
].join("\n");

writeFileSync(OUTPUT_PATH, xml, "utf8");

const robots = readFileSync(ROBOTS_PATH, "utf8")
  .split(/\r?\n/)
  .filter((line) => !/^\s*Sitemap:/i.test(line))
  .filter((line, index, lines) => line !== "" || lines[index - 1] !== "");
robots.push("", `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, `Sitemap: ${SITE_ORIGIN}/sites-sitemap.xml`, "");
writeFileSync(ROBOTS_PATH, robots.join("\n"), "utf8");
