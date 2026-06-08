import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  buildDiagramXml,
  type DiagramNode,
  type DiagramEdge,
} from "./drawio/diagram.js";
import { encodeForDataAttr } from "./utils/encodeForDataAttr.js";
import { getEditorHtml } from "./utils/getEditorHtml.js";
import { safeJsonForHtml } from "./utils/safeJsonForHtml.js";

// ---------------------------------------------------------------------------
// Shared input schemas
// ---------------------------------------------------------------------------

const NODE_SHAPES = [
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
  "process",
  "terminator",
  "cylinder",
  "cloud",
  "hexagon",
  "parallelogram",
] as const;

const nodeSchema = z.object({
  id: z.string().describe("Unique id for this node, referenced by edges."),
  label: z.string().optional().describe("Text shown inside the shape."),
  shape: z
    .enum(NODE_SHAPES)
    .optional()
    .describe(
      "Visual shape (default: rectangle). Use 'diamond' for decisions, 'terminator' for start/end, 'cylinder' for data stores.",
    ),
  x: z.number().optional().describe("Absolute x position. Omit to auto-layout."),
  y: z.number().optional().describe("Absolute y position. Omit to auto-layout."),
  width: z.number().optional(),
  height: z.number().optional(),
  fillColor: z.string().optional().describe("Fill color hex, e.g. '#dae8fc'."),
  strokeColor: z.string().optional().describe("Border color hex, e.g. '#6c8ebf'."),
});

const edgeSchema = z.object({
  source: z.string().describe("id of the source node."),
  target: z.string().describe("id of the target node."),
  label: z.string().optional().describe("Optional label on the connector."),
  dashed: z.boolean().optional().describe("Render the connector dashed."),
});

const directionSchema = z
  .enum(["vertical", "horizontal"])
  .optional()
  .describe("Auto-layout flow direction (default: vertical).");

export const EDITOR_RESOURCE_URI = "ui://drawio/editor";

// ---------------------------------------------------------------------------
// MCP Server Factory
// ---------------------------------------------------------------------------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "drawio-mcp-server",
    version: "1.0.0",
  });

  // Register the editor UI as an MCP App resource.
  registerAppResource(
    server,
    EDITOR_RESOURCE_URI,
    EDITOR_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: EDITOR_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await getEditorHtml(),
        },
      ],
    }),
  );

  // -------------------------------------------------------------------------
  // Tool: Create Diagram — build mxGraph XML from a structured description.
  // -------------------------------------------------------------------------
  server.registerTool(
    "create_diagram",
    {
      title: "Create Diagram",
      description:
        "Build a draw.io (diagrams.net) diagram from a structured description of nodes and edges. " +
        "Returns valid mxGraph XML that can be passed to render_diagram or opened in draw.io. " +
        "Positions are auto-laid-out when omitted — just describe what connects to what.",
      inputSchema: {
        nodes: z
          .array(nodeSchema)
          .describe("The shapes in the diagram, each with a unique id."),
        edges: z
          .array(edgeSchema)
          .optional()
          .describe("Connectors between nodes, referencing node ids."),
        direction: directionSchema,
      },
    },
    async ({ nodes, edges, direction }) => {
      try {
        const xml = buildDiagramXml(
          nodes as DiagramNode[],
          (edges ?? []) as DiagramEdge[],
          { direction },
        );
        return {
          content: [{ type: "text" as const, text: xml }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: String(error) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: Render Diagram (UI Tool) — interactive, editable draw.io canvas.
  // -------------------------------------------------------------------------
  registerAppTool(
    server,
    "render_diagram",
    {
      title: "Render Diagram",
      description:
        "Open an interactive, editable draw.io canvas in the client. " +
        "Call with NO arguments to open a blank canvas for the user to build from scratch, " +
        "or pass ready-made mxGraph `xml` (e.g. from create_diagram) or a structured `nodes`/`edges` " +
        "description to pre-load a diagram. The user can edit live and export to PNG, SVG, or XML. " +
        "This is the tool to use whenever the user wants to draw, render, visualize, or edit a diagram.",
      inputSchema: {
        xml: z
          .string()
          .optional()
          .describe("Ready-made mxGraph XML to render. Provide this OR nodes/edges."),
        nodes: z
          .array(nodeSchema)
          .optional()
          .describe("Nodes to build a diagram from (used when xml is not given)."),
        edges: z
          .array(edgeSchema)
          .optional()
          .describe("Edges connecting the nodes (used when xml is not given)."),
        direction: directionSchema,
        title: z
          .string()
          .optional()
          .describe("Title shown above the canvas (default: 'Diagram')."),
        editable: z
          .boolean()
          .optional()
          .describe("Allow editing in the canvas (default: true)."),
      },
      _meta: { ui: { resourceUri: EDITOR_RESOURCE_URI } },
    },
    async ({ xml, nodes, edges, direction, title, editable }) => {
      try {
        let diagramXml = xml;
        if (!diagramXml && nodes && nodes.length > 0) {
          diagramXml = buildDiagramXml(
            nodes as DiagramNode[],
            (edges ?? []) as DiagramEdge[],
            { direction },
          );
        }

        // No xml and no nodes => open a blank, editable canvas to start from
        // scratch. The editor UI defaults to an empty diagram when no xml is
        // provided.
        const renderData: Record<string, unknown> = {
          title: title ?? "Diagram",
          editable: editable ?? true,
        };
        if (diagramXml) renderData.xml = diagramXml;

        let html = await getEditorHtml();
        html = html.replace(
          '<div class="diagram-container">',
          `<div class="diagram-container" data-schema="${encodeForDataAttr(renderData)}">`,
        );
        html = html.replace(
          "</head>",
          `<script>window.DIAGRAM_DATA = ${safeJsonForHtml(renderData)};</script></head>`,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: renderData.title,
                editable: renderData.editable,
              }),
            },
            {
              type: "resource",
              resource: {
                uri: EDITOR_RESOURCE_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: html,
              },
            },
          ],
          _meta: { "mcpui.dev/ui-initial-render-data": renderData },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    },
  );

  return server;
}
