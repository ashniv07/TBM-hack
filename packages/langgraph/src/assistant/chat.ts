import {
  createAssistantSession,
  getAssistantSession,
  addAssistantMessage,
  getAssistantMessages,
  getAssistantContext,
  searchEntitiesByName,
  listDatasets,
  getQualityIssues,
  getReadinessScores,
  listAtumMappings,
  getCorrections,
  listTbmExports,
  getContextGraph,
  AssistantSession,
} from "@tbm/db";
import type { BaseMessage } from "@langchain/core/messages";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { type: string; id: string; name: string }[];
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  processingTime: number;
}

// ---------------------------------------------------------------------------
// Screen detection
// ---------------------------------------------------------------------------

type Screen = "import" | "relationships" | "quality" | "atum" | "export" | "dashboard" | "unknown";

function detectScreen(ctx: string): Screen {
  const s = ctx.toLowerCase();
  if (s.includes("import data") || s.includes("uploading"))         return "import";
  if (s.includes("relationships") || s.includes("knowledge graph")) return "relationships";
  if (s.includes("data quality") || s.includes("standardization"))  return "quality";
  if (s.includes("atum mapping") || s.includes("taxonomy"))         return "atum";
  if (s.includes("export") || s.includes("apptio"))                 return "export";
  if (s.includes("dashboard") || s.includes("analytics"))           return "dashboard";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Screen-specific context loaders
// ---------------------------------------------------------------------------

async function loadImportContext(): Promise<string[]> {
  const datasets = await listDatasets().catch(() => []);
  if (datasets.length === 0) return ["No datasets uploaded yet."];
  return [
    `${datasets.length} dataset(s) uploaded:`,
    ...datasets.map(d =>
      `  - ${d.file_name} | status: ${d.status} | rows: ${d.row_count ?? "?"} | source type: ${d.source_type ?? "unknown"}`
    ),
  ];
}

async function loadRelationshipsContext(): Promise<string[]> {
  const [graph, ctx] = await Promise.all([
    getContextGraph().catch(() => null),
    getAssistantContext().catch(() => null),
  ]);
  const lines: string[] = [];
  if (ctx) {
    lines.push(`Knowledge graph: ${ctx.entityCount} entities, ${ctx.edgeCount} relationships`);
    lines.push(`Entity types: ${Object.entries(ctx.entityTypes).map(([t, c]) => `${c} ${t}`).join(", ")}`);
  }
  if (graph && graph.nodes.length > 0) {
    const topByType: Record<string, string[]> = {};
    for (const n of graph.nodes) {
      if (!topByType[n.entity_type]) topByType[n.entity_type] = [];
      if (topByType[n.entity_type].length < 4) topByType[n.entity_type].push(n.canonical_name);
    }
    lines.push("Sample entities by type:");
    for (const [type, names] of Object.entries(topByType)) {
      lines.push(`  ${type}: ${names.join(", ")}`);
    }
    if (graph.edges.length > 0) {
      lines.push("Sample relationships:");
      for (const e of graph.edges.slice(0, 5)) {
        lines.push(`  ${e.from_name} -[${e.edge_type}]-> ${e.to_name}`);
      }
    }
  }
  return lines;
}

async function loadQualityContext(): Promise<string[]> {
  const [issues, scores, corrections] = await Promise.all([
    getQualityIssues({}).catch(() => []),
    getReadinessScores().catch(() => []),
    getCorrections({}).catch(() => []),
  ]);
  const lines: string[] = [];
  const open = issues.filter(i => i.status === "open");
  lines.push(`Quality issues: ${open.length} open, ${issues.length - open.length} resolved`);
  const bySeverity: Record<string, number> = {};
  for (const i of open) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  if (Object.keys(bySeverity).length) {
    lines.push(`Open by severity: ${Object.entries(bySeverity).map(([s, c]) => `${c} ${s}`).join(", ")}`);
  }
  if (open.length > 0) {
    lines.push("Top open issues:");
    for (const i of open.slice(0, 8)) {
      lines.push(`  - [${i.severity}] ${i.title} (${i.dataset_file_name})${i.suggested_fix ? ` → ${i.suggested_fix}` : ""}`);
    }
  }
  if (scores.length > 0) {
    const avg = scores.reduce((s, r) => s + Number(r.overall_score), 0) / scores.length;
    lines.push(`\nReadiness scores (avg ${Math.round(avg * 100)}%):`);
    for (const s of scores) {
      lines.push(`  - ${s.dataset_file_name}: ${Math.round(Number(s.overall_score) * 100)}% (completeness ${Math.round(Number(s.completeness_score) * 100)}%, validity ${Math.round(Number(s.validity_score) * 100)}%)`);
    }
  }
  const pending = corrections.filter(c => c.status === "pending");
  if (pending.length > 0) {
    lines.push(`\n${pending.length} correction(s) pending approval:`);
    for (const c of pending.slice(0, 5)) {
      lines.push(`  - ${c.correction_type}: "${c.original_value}" → "${c.corrected_value}" (${c.dataset_file_name})`);
    }
  }
  return lines;
}

async function loadAtumContext(): Promise<string[]> {
  const mappings = await listAtumMappings({}).catch(() => []);
  const lines: string[] = [];
  if (mappings.length === 0) { lines.push("No ATUM mappings yet."); return lines; }
  const byStatus: Record<string, number> = {};
  for (const m of mappings) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  lines.push(`ATUM mappings: ${mappings.length} total (${Object.entries(byStatus).map(([s, c]) => `${c} ${s}`).join(", ")})`);
  const byLayer: Record<string, { total: number; approved: number; suggested: number }> = {};
  for (const m of mappings) {
    if (!byLayer[m.layer]) byLayer[m.layer] = { total: 0, approved: 0, suggested: 0 };
    byLayer[m.layer].total++;
    if (m.status === "approved" || m.status === "overridden") byLayer[m.layer].approved++;
    if (m.status === "suggested") byLayer[m.layer].suggested++;
  }
  for (const [layer, s] of Object.entries(byLayer)) {
    lines.push(`  ${layer}: ${s.total} total, ${s.approved} approved, ${s.suggested} needs review`);
  }
  const needsReview = mappings.filter(m => m.status === "suggested").slice(0, 8);
  if (needsReview.length > 0) {
    lines.push("\nNeeds review:");
    for (const m of needsReview) {
      lines.push(`  - "${m.source_value}" → ${m.category_path ?? "unresolved"} (${Math.round(Number(m.confidence) * 100)}% conf, ${m.dataset_file_name})`);
    }
  }
  const low = mappings.filter(m => Number(m.confidence) < 0.6 && m.status !== "rejected").slice(0, 5);
  if (low.length > 0) {
    lines.push("\nLow-confidence mappings (<60%):");
    for (const m of low) {
      lines.push(`  - "${m.source_value}" → ${m.category_path ?? "unresolved"} (${Math.round(Number(m.confidence) * 100)}%)`);
    }
  }
  return lines;
}

async function loadExportContext(): Promise<string[]> {
  const [exports, ctx] = await Promise.all([
    listTbmExports().catch(() => []),
    getAssistantContext().catch(() => null),
  ]);
  const lines: string[] = [];
  if (ctx) {
    lines.push(`Entities available for export: ${ctx.entityCount} (${Object.entries(ctx.entityTypes).map(([t, c]) => `${c} ${t}`).join(", ")})`);
    lines.push(`ATUM mappings: ${ctx.mappingCount} total, ${ctx.approvedMappingCount} approved`);
  }
  if (exports.length === 0) {
    lines.push("No TBM exports generated yet.");
  } else {
    lines.push(`Export history (${exports.length}):`);
    for (const e of exports.slice(0, 5)) {
      lines.push(`  - ${e.export_type} | ${e.format} | ${e.status} | ${e.record_count ?? "?"} records | ${new Date(e.created_at).toLocaleDateString()}`);
    }
  }
  return lines;
}

async function loadDashboardContext(): Promise<string[]> {
  const [ctx, scores, issues, mappings] = await Promise.all([
    getAssistantContext().catch(() => null),
    getReadinessScores().catch(() => []),
    getQualityIssues({ status: "open" }).catch(() => []),
    listAtumMappings({}).catch(() => []),
  ]);
  const lines: string[] = [];
  if (ctx) {
    lines.push(`Platform overview:`);
    lines.push(`  - ${ctx.entityCount} entities, ${ctx.edgeCount} relationships, ${ctx.datasetCount} datasets`);
    lines.push(`  - ${ctx.issueCount} quality issues (${ctx.openIssueCount} open)`);
    lines.push(`  - ${ctx.mappingCount} ATUM mappings (${ctx.approvedMappingCount} approved)`);
    lines.push(`  - Avg readiness: ${Math.round(ctx.averageReadiness * 100)}%`);
    if (Object.keys(ctx.entityTypes).length) {
      lines.push(`  - Entity types: ${Object.entries(ctx.entityTypes).map(([t, c]) => `${c} ${t}`).join(", ")}`);
    }
  }
  const lowReady = scores.filter(s => Number(s.overall_score) < 0.7);
  if (lowReady.length) lines.push(`\n${lowReady.length} dataset(s) below 70% readiness`);
  const critical = issues.filter(i => i.severity === "critical");
  if (critical.length) lines.push(`${critical.length} critical quality issue(s) open`);
  const unresolved = mappings.filter(m => m.status === "unresolved" || m.status === "suggested");
  if (unresolved.length) lines.push(`${unresolved.length} ATUM mapping(s) need review`);
  return lines;
}

async function loadScreenContext(screen: Screen): Promise<string[]> {
  switch (screen) {
    case "import":        return loadImportContext();
    case "relationships": return loadRelationshipsContext();
    case "quality":       return loadQualityContext();
    case "atum":          return loadAtumContext();
    case "export":        return loadExportContext();
    default:              return loadDashboardContext();
  }
}

// ---------------------------------------------------------------------------
// Main processChat entrypoint
// ---------------------------------------------------------------------------

export async function processChat(input: {
  sessionId?: string;
  message: string;
  screenContext?: string;
}): Promise<ChatResponse> {
  const startTime = Date.now();

  let session: AssistantSession;
  if (input.sessionId) {
    session = (await getAssistantSession(input.sessionId).catch(() => null))
      ?? await createAssistantSession("New conversation");
  } else {
    session = await createAssistantSession("New conversation");
  }

  // Strip legacy client-side context prefix if present
  const cleanMessage = input.message.replace(/^\[User context:[^\]]+\]\s*\n\n/, "").trim();
  await addAssistantMessage({ sessionId: session.id, role: "user", content: cleanMessage });

  const response = await generateResponse(cleanMessage, session.id, input.screenContext ?? "");

  await addAssistantMessage({
    sessionId: session.id,
    role: "assistant",
    content: response.content,
    metadata: { sources: response.sources, processingTime: Date.now() - startTime },
  });

  return {
    sessionId: session.id,
    message: { role: "assistant", content: response.content, sources: response.sources },
    processingTime: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Core LLM response generator
// ---------------------------------------------------------------------------

const SCREEN_LABEL: Record<Screen, string> = {
  import:        "Import Data — Phase 1",
  relationships: "Relationships & Knowledge Graph — Phase 2",
  quality:       "Data Quality & Standardization — Phase 3",
  atum:          "ATUM Mapping — Phase 4",
  export:        "TBM Export — Phase 5",
  dashboard:     "Analytics Dashboard",
  unknown:       "Athena Platform",
};

async function generateResponse(
  query: string,
  sessionId: string,
  screenContext: string,
): Promise<{ content: string; sources?: { type: string; id: string; name: string }[] }> {

  const screen = detectScreen(screenContext);

  const [screenLines, entityHits, historyMsgs] = await Promise.all([
    loadScreenContext(screen),
    searchEntitiesByName(query.replace(/[^a-z0-9 ]/gi, " ").slice(0, 80), 6).catch(() => []),
    getAssistantMessages(sessionId).then(msgs => msgs.filter(m => m.role !== "system").slice(-12)).catch(() => []),
  ]);

  const entityCtx = entityHits.length > 0
    ? `\nEntities matching this query:\n${entityHits.map(e => `  - ${e.canonical_name} (${e.entity_type}, ${Math.round(Number(e.resolution_confidence) * 100)}% confidence)`).join("\n")}`
    : "";

  const systemPrompt = `You are Duke AI — the intelligent assistant built into Athena, a TBM (Technology Business Management) data intelligence platform for enterprise IT finance teams.

YOUR STRICT SCOPE — you ONLY answer questions about:
- The user's data in this platform (datasets, quality issues, readiness scores, entities, relationships)
- ATUM taxonomy mappings and TBM classifications
- TBM/ITFM concepts, IT cost management, and the Athena pipeline phases
- How to use Athena (what buttons do, what phases mean, next steps)

OUT OF SCOPE — if the user asks for anything outside the above (writing code, general programming, math, creative writing, unrelated general knowledge, or anything not related to TBM/IT finance), respond with exactly:
"I'm focused on your TBM data. Ask me about your datasets, quality issues, ATUM mappings, or the knowledge graph."

CURRENT SCREEN: ${SCREEN_LABEL[screen]}

LIVE PLATFORM DATA:
${screenLines.join("\n")}${entityCtx}

HOW TO ANSWER IN-SCOPE QUESTIONS:
- Platform data questions (datasets, mappings, issues, scores): cite specifics from the live data above.
- TBM/IT concepts ("what is X"): answer from your knowledge as a TBM expert.
- Mixed questions: brief concept explanation, then reference the platform data.

RESPONSE RULES:
1. Answer ONLY what the user asks. Do not volunteer unrelated data.
2. Be concise: 2–4 sentences for simple questions; structured Markdown for complex ones.
3. Never fabricate platform numbers, entity names, or mapping results.
4. Never expose internal UUIDs, storage paths, or raw embeddings.
5. Keep responses under 220 words unless detail is explicitly requested.
6. Use present tense. Be direct. No filler like "Great question!" or "Certainly!".`;

  if (!process.env.OPENAI_API_KEY) {
    return {
      content: `**Duke AI** — no OpenAI key configured.\n\n**${SCREEN_LABEL[screen]}**\n\n${screenLines.slice(0, 5).join("\n")}\n\nSet \`OPENAI_API_KEY\` to enable intelligent responses.`,
    };
  }

  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const { HumanMessage, SystemMessage, AIMessage } = await import("@langchain/core/messages");

    const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.15, maxTokens: 500 });

    // Build message thread: system + conversation history + current query
    const msgs: BaseMessage[] = [new SystemMessage(systemPrompt)];
    // historyMsgs already includes the current user message we just persisted; exclude it
    for (const h of historyMsgs.slice(0, -1)) {
      if (h.role === "user")      msgs.push(new HumanMessage(h.content));
      if (h.role === "assistant") msgs.push(new AIMessage(h.content));
    }
    msgs.push(new HumanMessage(query));

    const result = await model.invoke(msgs);
    return {
      content: String(result.content),
      sources: entityHits.slice(0, 3).map(e => ({ type: "entity", id: e.id, name: e.canonical_name })),
    };
  } catch (err) {
    console.error("[DukeAI] OpenAI error:", err);
    return {
      content: `I hit an error: ${err instanceof Error ? err.message : String(err)}. Try again or check the server logs.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Exported history helper
// ---------------------------------------------------------------------------

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  const messages = await getAssistantMessages(sessionId);
  return messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: m.metadata?.sources,
    }));
}

export { listAssistantSessions } from "@tbm/db";