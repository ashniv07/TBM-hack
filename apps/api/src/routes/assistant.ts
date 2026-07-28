import { Router } from "express";
import { processChat, getChatHistory, listAssistantSessions } from "@tbm/langgraph";
import { getAssistantSession, updateAssistantSessionTitle } from "@tbm/db";

export const assistantRouter = Router();

/**
 * POST /api/assistant/chat
 * Send a message to the AI assistant.
 */
assistantRouter.post("/chat", async (req, res) => {
  try {
    const { sessionId, message, screenContext } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await processChat({
      sessionId,
      message: message.trim(),
      screenContext: typeof screenContext === "string" ? screenContext : undefined,
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Chat failed" });
  }
});

/**
 * GET /api/assistant/sessions
 * List recent chat sessions.
 */
assistantRouter.get("/sessions", async (_req, res) => {
  try {
    const sessions = await listAssistantSessions();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list sessions" });
  }
});

/**
 * GET /api/assistant/sessions/:id
 * Get a specific session with messages.
 */
assistantRouter.get("/sessions/:id", async (req, res) => {
  try {
    const session = await getAssistantSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const messages = await getChatHistory(req.params.id);
    res.json({ session, messages });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get session" });
  }
});

/**
 * PATCH /api/assistant/sessions/:id
 * Update session title.
 */
assistantRouter.patch("/sessions/:id", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "Title is required" });
    }

    const session = await updateAssistantSessionTitle(req.params.id, title);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update session" });
  }
});

/**
 * GET /api/assistant/suggestions
 * Get suggested questions based on current data state.
 */
assistantRouter.get("/suggestions", async (_req, res) => {
  try {
    // These are example prompts the user can click
    const suggestions = [
      { category: "Overview", prompt: "Show summary" },
      { category: "Overview", prompt: "What can you do?" },
      { category: "Data Quality", prompt: "Which datasets have quality issues?" },
      { category: "Data Quality", prompt: "Why is the readiness score low?" },
      { category: "Data Quality", prompt: "Recommend fixes" },
      { category: "ATUM Mapping", prompt: "Show unmapped services" },
      { category: "Entity Info", prompt: "Tell me about AWS" },
    ];

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get suggestions" });
  }
});
