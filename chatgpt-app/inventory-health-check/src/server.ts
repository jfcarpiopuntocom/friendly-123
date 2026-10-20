import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { classifyInventory } from "./classify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(__dirname, "../public/inventory-card.html"), "utf8");
const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const RESOURCE_URI = "ui://inventory-health-check/card-v1.html";
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://inventory-health-check.jfcarpio.com";

const itemSchema = z.object({
  name: z.string().min(1).max(120),
  stock: z.number(),
  redAt: z.number().min(0).optional(),
  lowAt: z.number().min(0).optional(),
  price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  daysSinceLastSale: z.number().min(0).optional(),
  expiresInDays: z.number().optional()
});
const inputSchema = z.object({
  items: z.array(itemSchema).min(1).max(500),
  locale: z.enum(["en", "es", "pt"]).optional()
});

function createInventoryServer() {
  const server = new McpServer({ name: "inventory-health-check", version: "0.1.0" });

  registerAppResource(server, "inventory-health-card", RESOURCE_URI, {}, async () => ({
    contents: [{
      uri: RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: { ui: { domain: APP_ORIGIN, prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } }
    }]
  }));

  registerAppTool(server, "classify_inventory", {
    title: "Check inventory health",
    description: "Use this when a shop owner or operator wants to triage an inventory list by attention level. Classifies each item as Urgent/red, Low/orange, Dead weight/black after 45+ days without a sale, Star/yellow at 50%+ gross margin, or Healthy/green. Optional expiry information can raise severity. This is a read-only calculation over the inventory fields supplied in the call; it does not place orders, change inventory, browse external sources, or persist the submitted inventory.",
    inputSchema: {
      items: z.array(itemSchema).min(1).max(500),
      locale: z.enum(["en", "es", "pt"]).optional()
    },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async (args) => {
    const parsed = inputSchema.parse(args);
    const result = classifyInventory(parsed.items, parsed.locale ?? "en");
    const urgent = result.items.filter((x) => x.color === "red" || x.color === "orange").slice(0, 10);
    const labels = {
      en: { summary: `${result.counts.red} urgent; ${result.counts.orange} low; ${result.counts.black} dead weight; ${result.counts.yellow} stars; ${result.counts.green} healthy.`, none: "No red or orange items in the submitted list." },
      es: { summary: `${result.counts.red} urgentes; ${result.counts.orange} bajos; ${result.counts.black} peso muerto; ${result.counts.yellow} estrellas; ${result.counts.green} sanos.`, none: "No hay productos rojos o naranjas en la lista enviada." },
      pt: { summary: `${result.counts.red} urgentes; ${result.counts.orange} baixos; ${result.counts.black} parados; ${result.counts.yellow} estrelas; ${result.counts.green} saudáveis.`, none: "Não há itens vermelhos ou laranjas na lista enviada." }
    }[result.locale];
    const text = [labels.summary, urgent.length ? urgent.map((x) => `${x.name}: ${x.why}`).join("; ") : labels.none].join(" ");
    return { content: [{ type: "text", text }], structuredContent: result };
  });

  return server;
}

function sendJson(res: any, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) { res.writeHead(400).end("Missing URL"); return; }
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,GET,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "content-type,mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    sendJson(res, 200, { ok: true, name: "inventory-health-check", version: "0.1.0", mode: "anonymous-stateless", mcp: MCP_PATH });
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
    const token = process.env.OPENAI_APPS_CHALLENGE;
    if (!token) { res.writeHead(404).end("Challenge token not configured"); return; }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(token);
    return;
  }

  if (url.pathname === MCP_PATH && req.method && new Set(["POST", "GET", "DELETE"]).has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createInventoryServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, () => console.log(`Inventory Health Check v0.1.0 listening on :${PORT}${MCP_PATH}`));
