import { useState, useRef, useEffect } from "react";
import {
  ChatMessage, ChatSession, ChatSuggestion,
  sendChatMessage, fetchChatSessions, fetchChatHistory, fetchChatSuggestions,
} from "../api";

// Lightweight markdown → JSX renderer (no extra dependency)
function renderMd(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Blank line
    if (line.trim() === "") { i++; continue; }
    // Heading
    const h = line.match(/^(#{1,3})\s+(.+)/);
    if (h) {
      const level = h[1].length;
      const Tag = `h${level + 2}` as "h3" | "h4" | "h5";
      out.push(<Tag key={i} style={{ margin: "8px 0 4px", fontFamily: "var(--font-heading)", fontSize: level === 1 ? 15 : 13, color: "var(--text-primary)" }}>{inlineRender(h[2])}</Tag>);
      i++; continue;
    }
    // Bullet list: collect consecutive bullet lines
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ""));
        i++;
      }
      out.push(<ul key={`ul-${i}`} style={{ margin: "4px 0", paddingLeft: 16 }}>{items.map((it, j) => <li key={j} style={{ fontSize: 12, marginBottom: 2 }}>{inlineRender(it)}</li>)}</ul>);
      continue;
    }
    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      out.push(<ol key={`ol-${i}`} style={{ margin: "4px 0", paddingLeft: 18 }}>{items.map((it, j) => <li key={j} style={{ fontSize: 12, marginBottom: 2 }}>{inlineRender(it)}</li>)}</ol>);
      continue;
    }
    // Divider
    if (/^---+$/.test(line.trim())) {
      out.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--border)", margin: "6px 0" }} />);
      i++; continue;
    }
    // Normal paragraph
    out.push(<p key={i} style={{ margin: "3px 0", fontSize: 13, lineHeight: 1.6 }}>{inlineRender(line)}</p>);
    i++;
  }
  return out;
}

function inlineRender(text: string): React.ReactNode {
  // Split on **bold**, *italic*, and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} style={{ color: "var(--text-primary)" }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 3, fontSize: 11, fontFamily: "monospace" }}>{part.slice(1, -1)}</code>;
    return part;
  });
}

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  context: string;
}

export function DukeAI({ isOpen, onToggle, context }: Props) {
  const [sessionId,   setSessionId]   = useState<string | undefined>();
  const [sessions,    setSessions]    = useState<ChatSession[]>([]);
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const endRef    = useRef<HTMLDivElement>(null);
  const contextRef = useRef(context);

  useEffect(() => { contextRef.current = context; }, [context]);

  useEffect(() => {
    fetchChatSuggestions().then(setSuggestions).catch(() => {});
    fetchChatSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadSession(id: string) {
    try {
      const { session, messages: msgs } = await fetchChatHistory(id);
      setSessionId(session.id);
      setMessages(msgs);
    } catch { setError("Failed to load session"); }
  }

  async function send(text?: string) {
    const raw = (text ?? input).trim();
    if (!raw) return;

    setInput(""); setError(""); setLoading(true);
    setMessages(p => [...p, { role: "user", content: raw }]);

    try {
      const res = await sendChatMessage(raw, sessionId, contextRef.current);
      setSessionId(res.sessionId);
      setMessages(p => [...p, res.message]);
      fetchChatSessions().then(setSessions).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setMessages(p => p.slice(0, -1));
    } finally { setLoading(false); }
  }

  function newChat() { setSessionId(undefined); setMessages([]); setError(""); }

  const byCategory = suggestions.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {} as Record<string, ChatSuggestion[]>);

  return (
    <>
      {/* ── Floating Action Button ── */}
      <button className={`duke-fab ${isOpen ? "open" : ""}`} onClick={onToggle} title="Duke AI">
        {isOpen ? "✕" : "D"}
        {!isOpen && <span className="duke-badge" />}
      </button>

      {/* ── Chat Panel ── */}
      <div className={`duke-panel ${isOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="duke-panel-header">
          <div className="duke-panel-logo">D</div>
          <div>
            <div className="duke-panel-name">Duke AI</div>
            <div className="duke-panel-sub">Ask anything about your data</div>
          </div>
          <button className="duke-new-btn" onClick={newChat}>New</button>
        </div>

        {/* Context strip */}
        {context && (
          <div className="duke-ctx-bar" title={context}>
            ● {context.length > 90 ? context.slice(0, 90) + "…" : context}
          </div>
        )}

        {/* Messages */}
        <div className="duke-messages">
          {messages.length === 0 ? (
            <div className="duke-welcome">
              <div className="duke-welcome-name">Duke AI</div>
              <div className="duke-welcome-sub">
                Ask me about your enterprise data, ATUM mappings, data quality, knowledge graph, or anything else on screen.
              </div>
              <div className="duke-suggestions">
                {Object.entries(byCategory).slice(0, 4).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="duke-sug-cat">{cat}</div>
                    {items.slice(0, 2).map((s, i) => (
                      <button key={i} className="duke-sug-btn" onClick={() => send(s.prompt)} disabled={loading}>
                        {s.prompt}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`duke-msg ${m.role}`}>
                <div className="duke-msg-av">{m.role === "user" ? "U" : "D"}</div>
                <div className="duke-bubble">
                  {m.role === "assistant"
                    ? renderMd(m.content)
                    : <p style={{ margin: 0, fontSize: 13 }}>{m.content}</p>
                  }
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-dim)" }}>
                      {m.sources.map((src, si) => (
                        <span key={si} style={{ marginRight: 6 }}>· {src.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="duke-msg assistant">
              <div className="duke-msg-av">D</div>
              <div className="duke-bubble">
                <div className="duke-typing"><span /><span /><span /></div>
              </div>
            </div>
          )}

          {error && <div className="error-bar" style={{ margin: 0 }}>{error}</div>}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="duke-input-row">
          <textarea
            className="duke-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask Duke AI…"
            rows={1}
          />
          <button className="duke-send" onClick={() => send()} disabled={loading || !input.trim()}>→</button>
        </div>
      </div>
    </>
  );
}
