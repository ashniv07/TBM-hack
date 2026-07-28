import { useState, useRef, useEffect } from "react";
import {
  ChatMessage,
  ChatSession,
  ChatSuggestion,
  sendChatMessage,
  fetchChatSessions,
  fetchChatHistory,
  fetchChatSuggestions,
} from "../api";

export function AiAssistant() {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSuggestions();
    loadSessions();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function loadSuggestions() {
    try {
      const data = await fetchChatSuggestions();
      setSuggestions(data);
    } catch (err) {
      console.error("Failed to load suggestions:", err);
    }
  }

  async function loadSessions() {
    try {
      const data = await fetchChatSessions();
      setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }

  async function loadSession(id: string) {
    try {
      const { session, messages } = await fetchChatHistory(id);
      setSessionId(session.id);
      setMessages(messages);
    } catch (err) {
      setError("Failed to load session");
    }
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleSend(text?: string) {
    const messageText = text || input.trim();
    if (!messageText) return;

    setInput("");
    setError("");
    setLoading(true);

    // Add user message immediately
    const userMessage: ChatMessage = { role: "user", content: messageText };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await sendChatMessage(messageText, sessionId);
      setSessionId(response.sessionId);
      setMessages((prev) => [...prev, response.message]);
      await loadSessions(); // Refresh session list
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function startNewSession() {
    setSessionId(undefined);
    setMessages([]);
  }

  // Group suggestions by category
  const suggestionsByCategory = suggestions.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {} as Record<string, ChatSuggestion[]>);

  return (
    <div className="assistant-container">
      <div className="assistant-sidebar">
        <button onClick={startNewSession} className="new-chat-btn">
          + New Chat
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${sessionId === session.id ? "active" : ""}`}
              onClick={() => loadSession(session.id)}
            >
              <span className="session-title">{session.title || "Untitled"}</span>
              <span className="session-date">
                {new Date(session.updated_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="assistant-main">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="assistant-welcome">
              <h3>TBM AI Assistant</h3>
              <p>Ask me questions about your enterprise data, ATUM mappings, data quality, and more.</p>

              <div className="suggestions-grid">
                {Object.entries(suggestionsByCategory).map(([category, items]) => (
                  <div key={category} className="suggestion-category">
                    <h4>{category}</h4>
                    {items.map((s, i) => (
                      <button
                        key={i}
                        className="suggestion-btn"
                        onClick={() => handleSend(s.prompt)}
                        disabled={loading}
                      >
                        {s.prompt}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.role}`}>
                  <div className="message-content">
                    {msg.role === "assistant" ? (
                      <div dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="message-sources">
                      <span>Sources:</span>
                      {msg.sources.map((s, j) => (
                        <span key={j} className="source-tag">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="message assistant">
                  <div className="message-content typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {error && <div className="assistant-error">{error}</div>}

        <div className="input-container">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data..."
            disabled={loading}
            rows={1}
          />
          <button onClick={() => handleSend()} disabled={loading || !input.trim()}>
            {loading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatMessage(content: string): string {
  // Convert markdown-style formatting to HTML
  return content
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n- /g, "</p><li>")
    .replace(/\n(\d+)\. /g, "</p><li>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p><\/p>/g, "")
    .replace(/<li>/g, "<ul><li>")
    .replace(/<\/li><\/p>/g, "</li></ul>");
}
