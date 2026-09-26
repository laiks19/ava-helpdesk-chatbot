import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Vercel serves the Ava logo before the SPA fallback", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const logoRouteIndex = config.routes.findIndex((route) => route.src === "/ava-helpdesk-logo.png");
  const fallbackRouteIndex = config.routes.findIndex((route) => route.dest === "/index.html");

  assert.notEqual(logoRouteIndex, -1);
  assert.equal(config.routes[logoRouteIndex].dest, "/ava-helpdesk-logo.png");
  assert.ok(logoRouteIndex < fallbackRouteIndex);
});
