import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const site = JSON.parse(await readFile(new URL("../site.config.json", import.meta.url), "utf8"));
const canonical = new URL(site.canonicalUrl).href;
const scripts = [...html.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
const schema = JSON.parse(scripts[0]?.[1] ?? "null");
const entity = (type) => schema?.["@graph"]?.find((node) => node["@type"] === type);
const values = function* (item) {
  if (!item || typeof item !== "object") return;
  yield item;
  for (const child of Object.values(item)) yield* values(child);
};

test("structured data is one valid JSON-LD graph with unique, resolvable entity references", () => {
  assert.equal(scripts.length, 1);
  assert.equal(schema["@context"], "https://schema.org");
  assert.equal(schema["@graph"].length, 4);
  const ids = new Set(schema["@graph"].map((node) => node["@id"]));
  assert.equal(ids.size, schema["@graph"].length);
  for (const type of ["Organization", "WebSite", "WebPage", "WebApplication"]) assert.ok(entity(type), type);
  for (const node of values(schema)) {
    if (!node["@id"]) continue;
    assert.ok(node["@id"].startsWith(`${canonical}#`), node["@id"]);
    assert.ok(ids.has(node["@id"]), `unresolved reference: ${node["@id"]}`);
  }
  assert.equal(entity("WebPage").isPartOf["@id"], entity("WebSite")["@id"]);
  assert.equal(entity("WebPage").mainEntity["@id"], entity("WebApplication")["@id"]);
  assert.equal(entity("WebApplication").mainEntityOfPage["@id"], entity("WebPage")["@id"]);
  for (const type of ["WebSite", "WebApplication"]) assert.equal(entity(type).publisher["@id"], entity("Organization")["@id"]);
});

test("public canonical, language, page title, and app identity agree with the actual markup", () => {
  assert.equal(html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1], canonical);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = html.match(/<meta\b[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1];
  const name = html.match(/<meta\b[^>]*name="application-name"[^>]*content="([^"]+)"/i)?.[1];
  const language = html.match(/<html\b[^>]*lang="([^"]+)"/i)?.[1];
  assert.equal(entity("WebPage").name, title);
  assert.equal(entity("WebPage").description, description);
  for (const type of ["Organization", "WebSite", "WebApplication"]) assert.equal(entity(type).name, name);
  for (const node of schema["@graph"]) assert.equal(node.url, canonical);
  for (const type of ["WebPage", "WebSite", "WebApplication"]) assert.equal(entity(type).inLanguage, language);
  assert.equal(entity("WebApplication").applicationCategory, "EducationalApplication");
  assert.match(entity("WebApplication").description, /review library/i);
});

test("software-app eligibility fields describe the actual free browser application", () => {
  const app = entity("WebApplication");
  assert.equal(app.operatingSystem, "Any");
  assert.match(app.browserRequirements, /JavaScript.*modern web browser/);
  assert.equal(app.isAccessibleForFree, true);
  assert.deepEqual(app.offers, { "@type": "Offer", price: 0, priceCurrency: "USD", url: canonical });
  // Pricing is visible in the actual page, rather than asserted only to a crawler.
  assert.match(html.split(/<body\b[^>]*>/i)[1], /Free to use in a modern browser\./);
  assert.equal([...values(schema)].filter(node => node["@type"] === "Offer").length, 1);
});

test("organization logo names the displayed PNG with its real pixel dimensions", async () => {
  const logo = entity("Organization").logo;
  assert.equal(logo["@type"], "ImageObject");
  assert.equal(logo.contentUrl, logo.url);
  const url = new URL(logo.url);
  assert.equal(url.origin, new URL(canonical).origin);
  assert.ok(url.pathname.startsWith("/icons/"));
  assert.match(html, new RegExp(`class="brand-mark"[^>]*src="${url.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  const image = await readFile(new URL(`../public${url.pathname}`, import.meta.url));
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.toString("ascii", 12, 16), "IHDR");
  assert.equal(logo.width, image.readUInt32BE(16));
  assert.equal(logo.height, image.readUInt32BE(20));
});

test("schema does not invent ratings, paid offers, business details, or search endpoints", () => {
  const unsupported = new Set(["aggregateRating", "review", "reviews", "address", "telephone", "email", "contactPoint", "geo", "openingHours", "priceRange", "hasCredential", "hasCertification", "accreditation", "award", "awards", "potentialAction"]);
  for (const node of values(schema)) {
    for (const property of Object.keys(node)) assert.ok(!unsupported.has(property), property);
    assert.ok(!["LocalBusiness", "VeterinaryCare", "School", "SearchAction", "Review", "AggregateRating"].includes(node["@type"]), node["@type"]);
    if (Object.hasOwn(node, "offers")) assert.equal(node, entity("WebApplication"));
    if (Object.hasOwn(node, "price")) {
      assert.equal(node["@type"], "Offer");
      assert.equal(node.price, 0);
    }
  }
});
