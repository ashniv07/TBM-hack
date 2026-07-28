import {
  createAssistantSession,
  getAssistantSession,
  addAssistantMessage,
  getAssistantMessages,
  getAssistantContext,
  searchEntitiesByName,
  getAtumMappingForEntity,
  listDatasets,
  getQualityIssues,
  getReadinessScores,
  listAtumMappings,
  AssistantSession,
  AssistantMessage,
} from "@tbm/db";

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

// Intent detection patterns
const INTENT_PATTERNS = {
  mappingExplanation: /why\s+(was|is)\s+(.+)\s+mapped\s+to/i,
  entityInfo: /(?:tell me about|what is|show|find)\s+(.+)/i,
  qualityIssues: /(?:which|what)\s+datasets?\s+(?:have|contain|has)\s+(?:quality\s+)?issues?/i,
  readinessScore: /(?:why|what)\s+(?:is|are)\s+(?:the\s+)?readiness\s+score/i,
  unmappedServices: /(?:show|list|find)\s+unmapped\s+(?:services?|applications?|entities?)/i,
  recommendFixes: /(?:recommend|suggest)\s+(?:fixes?|solutions?|corrections?)/i,
  summary: /(?:summary|overview|status|dashboard)/i,
  help: /(?:help|what can you do|commands)/i,
};

/**
 * Process a user message and generate an AI response.
 * Uses RAG over the enterprise knowledge graph and TBM data.
 */
export async function processChat(input: {
  sessionId?: string;
  message: string;
}): Promise<ChatResponse> {
  const startTime = Date.now();

  // Get or create session
  let session: AssistantSession;
  if (input.sessionId) {
    const existing = await getAssistantSession(input.sessionId);
    if (existing) {
      session = existing;
    } else {
      session = await createAssistantSession("New conversation");
    }
  } else {
    session = await createAssistantSession("New conversation");
  }

  // Save user message
  await addAssistantMessage({
    sessionId: session.id,
    role: "user",
    content: input.message,
  });

  // Detect intent and generate response
  const response = await generateResponse(input.message);

  // Save assistant message
  await addAssistantMessage({
    sessionId: session.id,
    role: "assistant",
    content: response.content,
    metadata: { sources: response.sources, processingTime: Date.now() - startTime },
  });

  return {
    sessionId: session.id,
    message: {
      role: "assistant",
      content: response.content,
      sources: response.sources,
    },
    processingTime: Date.now() - startTime,
  };
}

async function generateResponse(query: string): Promise<{ content: string; sources?: { type: string; id: string; name: string }[] }> {
  const queryLower = query.toLowerCase();

  // Help intent
  if (INTENT_PATTERNS.help.test(queryLower)) {
    return {
      content: `I can help you understand your TBM data. Try asking me:

**Mapping Questions:**
- "Why was [entity] mapped to [category]?"
- "Show unmapped services"

**Data Quality:**
- "Which datasets have quality issues?"
- "Why is the readiness score low?"
- "Recommend fixes"

**Entity Information:**
- "Tell me about [entity name]"
- "Find [vendor/application/service name]"

**Overview:**
- "Show summary" or "Dashboard status"`,
    };
  }

  // Summary/overview intent
  if (INTENT_PATTERNS.summary.test(queryLower)) {
    const context = await getAssistantContext();
    return {
      content: `**Enterprise Data Summary**

**Knowledge Graph:** ${context.entityCount} entities connected by ${context.edgeCount} relationships
**Datasets:** ${context.datasetCount} uploaded

**Entity Breakdown:**
${Object.entries(context.entityTypes).map(([type, count]) => `- ${type}: ${count}`).join("\n")}

**Data Quality:** ${context.issueCount} issues detected (${context.openIssueCount} open)
**Average Readiness Score:** ${Math.round(context.averageReadiness * 100)}%

**ATUM Mappings:** ${context.mappingCount} total (${context.approvedMappingCount} approved)

${context.recentIssues.length > 0 ? `**Recent Issues:**\n${context.recentIssues.map(i => `- [${i.severity}] ${i.title} (${i.dataset})`).join("\n")}` : ""}`,
      sources: [{ type: "context", id: "summary", name: "Enterprise Context Summary" }],
    };
  }

  // Quality issues intent
  if (INTENT_PATTERNS.qualityIssues.test(queryLower)) {
    const issues = await getQualityIssues({ status: "open" });
    const byDataset = new Map<string, typeof issues>();
    for (const issue of issues) {
      const key = issue.dataset_file_name;
      if (!byDataset.has(key)) byDataset.set(key, []);
      byDataset.get(key)!.push(issue);
    }

    if (byDataset.size === 0) {
      return { content: "No open quality issues found across your datasets. Great job!" };
    }

    const lines = Array.from(byDataset.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([dataset, dsIssues]) => {
        const critical = dsIssues.filter(i => i.severity === "critical").length;
        const summary = `**${dataset}**: ${dsIssues.length} issues${critical > 0 ? ` (${critical} critical)` : ""}`;
        const samples = dsIssues.slice(0, 2).map(i => `  - ${i.title}`).join("\n");
        return `${summary}\n${samples}`;
      });

    return {
      content: `**Datasets with Quality Issues:**\n\n${lines.join("\n\n")}`,
      sources: Array.from(byDataset.keys()).slice(0, 5).map(name => ({ type: "dataset", id: name, name })),
    };
  }

  // Readiness score intent
  if (INTENT_PATTERNS.readinessScore.test(queryLower)) {
    const scores = await getReadinessScores();
    if (scores.length === 0) {
      return { content: "No readiness scores available yet. Run Stage 5 (Data Quality & Standardization) first." };
    }

    const lowScores = scores.filter(s => s.overall_score < 0.7);
    const avgScore = scores.reduce((sum, s) => sum + Number(s.overall_score), 0) / scores.length;

    let content = `**TBM Readiness Overview**\n\nAverage readiness score: **${Math.round(avgScore * 100)}%**\n\n`;

    if (lowScores.length > 0) {
      content += `**Datasets Needing Attention (< 70%):**\n`;
      for (const score of lowScores.slice(0, 5)) {
        content += `\n**${score.dataset_file_name}** (${Math.round(Number(score.overall_score) * 100)}%)\n`;
        content += `- Completeness: ${Math.round(Number(score.completeness_score) * 100)}%\n`;
        content += `- Validity: ${Math.round(Number(score.validity_score) * 100)}%\n`;
        content += `- Consistency: ${Math.round(Number(score.consistency_score) * 100)}%\n`;
        content += `- Uniqueness: ${Math.round(Number(score.uniqueness_score) * 100)}%\n`;
        if (score.recommendations && score.recommendations.length > 0) {
          content += `- Recommendations: ${score.recommendations.slice(0, 2).join("; ")}\n`;
        }
      }
    } else {
      content += "All datasets meet the 70% readiness threshold.";
    }

    return { content, sources: lowScores.slice(0, 5).map(s => ({ type: "dataset", id: s.dataset_id, name: s.dataset_file_name })) };
  }

  // Unmapped services intent
  if (INTENT_PATTERNS.unmappedServices.test(queryLower)) {
    const mappings = await listAtumMappings({ status: "unresolved" });
    if (mappings.length === 0) {
      return { content: "No unresolved mappings found. All entities have been classified." };
    }

    const samples = mappings.slice(0, 10);
    const content = `**Unmapped Entities (${mappings.length} total):**\n\n${samples.map(m =>
      `- **${m.source_value}** (${m.dataset_file_name}, ${m.column_name})\n  Confidence: ${Math.round(Number(m.confidence) * 100)}%`
    ).join("\n\n")}`;

    return { content, sources: samples.map(m => ({ type: "mapping", id: m.id, name: m.source_value })) };
  }

  // Recommend fixes intent
  if (INTENT_PATTERNS.recommendFixes.test(queryLower)) {
    const issues = await getQualityIssues({ status: "open" });
    const critical = issues.filter(i => i.severity === "critical");
    const highPriority = [...critical, ...issues.filter(i => i.severity === "error")].slice(0, 5);

    if (highPriority.length === 0) {
      return { content: "No urgent fixes needed. Your data quality looks good!" };
    }

    const content = `**Recommended Fixes (Priority Order):**\n\n${highPriority.map((issue, i) =>
      `${i + 1}. **[${issue.severity.toUpperCase()}] ${issue.title}**\n` +
      `   Dataset: ${issue.dataset_file_name}\n` +
      `   ${issue.description}\n` +
      (issue.suggested_fix ? `   **Fix:** ${issue.suggested_fix}` : "")
    ).join("\n\n")}`;

    return { content, sources: highPriority.map(i => ({ type: "issue", id: i.id, name: i.title })) };
  }

  // Mapping explanation intent
  const mappingMatch = query.match(INTENT_PATTERNS.mappingExplanation);
  if (mappingMatch) {
    const entityName = mappingMatch[2].replace(/['"]/g, "").trim();
    const mapping = await getAtumMappingForEntity(entityName);

    if (!mapping) {
      return { content: `I couldn't find an ATUM mapping for "${entityName}". It may not be mapped yet or the name might be different in the system.` };
    }

    return {
      content: `**ATUM Mapping Explanation for "${mapping.source_value}"**

**Classification:** ${mapping.category_path || "Unresolved"}
**Confidence:** ${Math.round(Number(mapping.confidence) * 100)}%
**Method:** ${mapping.method}
**Status:** ${mapping.status}

**Reasoning:**
${mapping.reasoning || "No specific reasoning provided."}

**Source:**
- Dataset: ${mapping.dataset_file_name}
- Column: ${mapping.column_name} (${mapping.semantic_role || "unknown role"})

${mapping.evidence ? `**Evidence:**
- Vector similarity: ${mapping.evidence.vectorSimilarity ? Math.round(Number(mapping.evidence.vectorSimilarity) * 100) + "%" : "N/A"}
- Lexical score: ${mapping.evidence.lexicalScore ? Math.round(Number(mapping.evidence.lexicalScore) * 100) + "%" : "N/A"}
- Rule: ${mapping.evidence.rule || "None"}` : ""}`,
      sources: [{ type: "mapping", id: mapping.id, name: mapping.source_value }],
    };
  }

  // Entity info intent
  const entityMatch = query.match(INTENT_PATTERNS.entityInfo);
  if (entityMatch) {
    const searchTerm = entityMatch[1].replace(/['"]/g, "").trim();
    const entities = await searchEntitiesByName(searchTerm, 5);

    if (entities.length === 0) {
      return { content: `I couldn't find any entities matching "${searchTerm}" in the knowledge graph.` };
    }

    const entity = entities[0];
    const mapping = await getAtumMappingForEntity(entity.canonical_name);

    let content = `**Entity: ${entity.canonical_name}**\n\n`;
    content += `- Type: ${entity.entity_type}\n`;
    content += `- Confidence: ${Math.round(Number(entity.resolution_confidence) * 100)}%\n`;

    if (mapping) {
      content += `\n**ATUM Classification:** ${mapping.category_path || "Unresolved"}\n`;
      content += `- Confidence: ${Math.round(Number(mapping.confidence) * 100)}%\n`;
    }

    if (entities.length > 1) {
      content += `\n**Related entities:**\n${entities.slice(1).map(e => `- ${e.canonical_name} (${e.entity_type})`).join("\n")}`;
    }

    return { content, sources: [{ type: "entity", id: entity.id, name: entity.canonical_name }] };
  }

  // Default response - try to provide helpful context
  const context = await getAssistantContext();
  return {
    content: `I'm not sure how to answer that specific question. Here's what I can tell you:

**Current Status:**
- ${context.entityCount} entities in knowledge graph
- ${context.issueCount} quality issues (${context.openIssueCount} open)
- ${context.mappingCount} ATUM mappings (${context.approvedMappingCount} approved)
- Average readiness: ${Math.round(context.averageReadiness * 100)}%

Try asking me about specific entities, quality issues, or ATUM mappings. Type "help" for more options.`,
  };
}

/**
 * Get chat history for a session.
 */
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

/**
 * List recent chat sessions.
 */
export { listAssistantSessions } from "@tbm/db";
