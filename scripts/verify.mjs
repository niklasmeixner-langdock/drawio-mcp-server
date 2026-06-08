// End-to-end check of the MCP tools via an in-memory client.
// Run with: node scripts/verify.mjs  (after `pnpm build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/server.js";

let failures = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = createMcpServer();
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "verify", version: "1.0.0" });
await Promise.all([server.connect(serverT), client.connect(clientT)]);

// 1. Tools advertised
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check("lists create_diagram + render_diagram", names.includes("create_diagram") && names.includes("render_diagram"), names.join(", "));

// 2. Editor UI resource registered
const { resources } = await client.listResources();
check("registers ui://drawio/editor resource", resources.some((r) => r.uri === "ui://drawio/editor"), resources.map((r) => r.uri).join(", "));

// 3. create_diagram -> valid mxGraph XML
const created = await client.callTool({
  name: "create_diagram",
  arguments: {
    nodes: [
      { id: "start", label: "Start", shape: "terminator" },
      { id: "decide", label: "Approved?", shape: "diamond" },
      { id: "yes", label: "Ship it" },
      { id: "no", label: "Send back" },
    ],
    edges: [
      { source: "start", target: "decide" },
      { source: "decide", target: "yes", label: "yes" },
      { source: "decide", target: "no", label: "no", dashed: true },
    ],
  },
});
const xml = created.content?.[0]?.text ?? "";
check("create_diagram not error", !created.isError);
check("xml has mxGraphModel root cells", xml.includes("<mxGraphModel") && xml.includes('<mxCell id="0"') && xml.includes('<mxCell id="1" parent="0"'));
check("xml contains all 4 vertices", ["start", "decide", "yes", "no"].every((id) => xml.includes(`id="${id}"`)));
check("xml contains 3 edges", (xml.match(/edge="1"/g) || []).length === 3, `found ${(xml.match(/edge="1"/g) || []).length}`);
check("diamond shape applied to decision", xml.includes("rhombus"));
check("dashed edge applied", xml.includes("dashed=1"));
check("auto-layout produced geometry", (xml.match(/<mxGeometry /g) || []).length >= 4);

// 4. render_diagram only takes xml/title (NOT nodes/edges — building belongs to create_diagram)
const renderProps = tools.find((t) => t.name === "render_diagram")?.inputSchema?.properties ?? {};
check("render_diagram inputs are xml + title only", Object.keys(renderProps).sort().join(",") === "title,xml", Object.keys(renderProps).join(", "));

// 5. render_diagram(xml) -> UI resource with injected data
const rendered = await client.callTool({
  name: "render_diagram",
  arguments: { title: "Release Flow", xml },
});
check("render_diagram not error", !rendered.isError);
const resourceItem = rendered.content?.find((c) => c.type === "resource");
const html = resourceItem?.resource?.text ?? "";
check("render returns editor resource", resourceItem?.resource?.uri === "ui://drawio/editor");
check("html injects window.DIAGRAM_DATA", html.includes("window.DIAGRAM_DATA ="));
check("html renders via in-document viewer script (like google-maps)", html.includes("viewer.diagrams.net/js/viewer-static.min.js"));
check("html does NOT use a nested editor iframe", !html.includes("embed.diagrams.net"));
check("initial-render-data carries xml", !!rendered._meta?.["mcpui.dev/ui-initial-render-data"]?.xml);
check("render data carries title", rendered._meta?.["mcpui.dev/ui-initial-render-data"]?.title === "Release Flow");

// 6. mirrors google-maps exactly: no CSP overrides on the resource
const readRes = await client.readResource({ uri: "ui://drawio/editor" });
check("resource declares no CSP overrides (matches google-maps)", !readRes.contents?.[0]?._meta?.ui?.csp);

// 7. render_diagram with no xml -> blank canvas
const blank = await client.callTool({ name: "render_diagram", arguments: {} });
const blankResource = blank.content?.find((c) => c.type === "resource");
check("render_diagram opens blank canvas with no xml", !blank.isError && blankResource?.resource?.uri === "ui://drawio/editor");
check("blank render still serves the viewer html", (blankResource?.resource?.text ?? "").includes("viewer.diagrams.net"));

await client.close();
await server.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
