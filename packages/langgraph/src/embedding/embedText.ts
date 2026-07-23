const EMBEDDING_DIM = 1536;

/**
 * Deterministic, dependency-free fallback so the embedding stage still runs
 * end-to-end without an OPENAI_API_KEY. It is NOT semantically meaningful
 * (no learned notion of "Amazon EC2" ~ "AWS EC2") — it exists purely so the
 * pipeline, storage, and similarity-search plumbing can be demoed/tested
 * without a key. Real similarity matching requires the OpenAI path below.
 */
function hashEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const idx = (charCode * (i + 1)) % EMBEDDING_DIM;
    vector[idx] += Math.sin(charCode + i);
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    return texts.map(hashEmbedding);
  }

  try {
    const { OpenAIEmbeddings } = await import("@langchain/openai");
    const embedder = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
    return await embedder.embedDocuments(texts);
  } catch {
    return texts.map(hashEmbedding);
  }
}
