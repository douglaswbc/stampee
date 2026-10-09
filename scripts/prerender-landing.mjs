import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const server = await createServer({
  configFile: false,
  plugins: [react()],
  mode: "production",
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
  resolve: { alias: { "@": resolve(process.cwd()) } },
});

try {
  const { default: MarketingLandingPage } = await server.ssrLoadModule("/components/MarketingLandingPage.tsx");
  const markup = renderToStaticMarkup(React.createElement(MarketingLandingPage));
  const outputPath = resolve(process.cwd(), "dist", "index.html");
  const html = await readFile(outputPath, "utf8");
  const emptyRoot = '<div id="root"></div>';

  if (!html.includes(emptyRoot)) {
    throw new Error("Could not find the empty application root in dist/index.html.");
  }

  await writeFile(outputPath, html.replace(emptyRoot, `<div id="root">${markup}</div>`), "utf8");
} finally {
  await server.close();
}
