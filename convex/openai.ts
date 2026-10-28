/** OpenAI embeddings, used only to turn chunks and questions into vectors. Claude does everything else. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

type EmbeddingResponse = { data: { index: number; embedding: number[] }[] };

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on this Convex deployment");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, encoding_format: "float" }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI embeddings returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as EmbeddingResponse;
  const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  if (vectors.length !== texts.length) throw new Error(`Expected ${texts.length} embeddings, got ${vectors.length}`);
  return vectors;
}
