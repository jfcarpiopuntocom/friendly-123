import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const plugin = JSON.parse(fs.readFileSync(path.join(root, "submission/plugin.json"), "utf8"));
const mcp = JSON.parse(fs.readFileSync(path.join(root, "submission/mcp.json"), "utf8"));
const fail = (m) => { throw new Error(m); };
const ext = plugin.extensions?.["com.openai"];
const ui = ext?.interface;
const review = ext?.review;
if (!ui) fail("extensions.com.openai.interface missing");
if (!review) fail("extensions.com.openai.review missing");
if (!ui.displayName || ui.displayName.length > 30) fail("displayName missing or >30");
if (!ui.shortDescription || ui.shortDescription.length > 30) fail("shortDescription missing or >30");
if (!ui.longDescription || ui.longDescription.length > 4000) fail("longDescription missing or >4000");
for (const key of ["websiteURL","supportURL","privacyPolicyURL","termsOfServiceURL"]) {
  if (!String(ui[key] || "").startsWith("https://")) fail(`${key} must be HTTPS`);
}
for (const key of ["logo","composerIcon"]) {
  const rel=ui[key];
  if (!rel || !rel.startsWith("./")) fail(`${key} must be a relative ./ path`);
  if (!fs.existsSync(path.join(root,"submission",rel))) fail(`${key} file missing: ${rel}`);
}
const prompts=Array.isArray(ui.defaultPrompt)?ui.defaultPrompt:[ui.defaultPrompt].filter(Boolean);
if (prompts.length > 3 || prompts.some((x)=>String(x).length>128)) fail("starter prompt limits violated");
const positive=review.test_cases?.positive || [];
const negative=review.test_cases?.negative || [];
if (positive.length !== 5) fail(`expected exactly 5 positive cases, got ${positive.length}`);
if (negative.length !== 3) fail(`expected exactly 3 negative cases, got ${negative.length}`);
for (const [i,c] of positive.entries()) {
  for (const k of ["description","prompt","tools_triggered","expected_behavior"]) if (!c[k]) fail(`positive[${i}].${k} missing`);
}
for (const [i,c] of negative.entries()) {
  for (const k of ["description","prompt"]) if (!c[k]) fail(`negative[${i}].${k} missing`);
}
const server=mcp.mcpServers?.["inventory-health-check"];
if (!server || server.type !== "streamable-http" || !String(server.url||"").startsWith("https://") || !server.url.endsWith("/mcp")) fail("production MCP mapping invalid");
if (review.commerce !== false) fail("commerce must be explicitly false");
console.log("submission package: OK");
