/**
 * AI-Client: Provider-Abstraktion mit Fallback.
 *
 * Primaer: Nvidia AI Foundry (OpenAI-kompatibel) — kostenlos fuer der User.
 *   Base URL: https://integrate.api.nvidia.com/v1
 *   Auth:     Authorization: Bearer nvapi-...
 *   Model:    meta/llama-3.3-70b-instruct (gross, gut fuer strukturierte Analyse)
 *
 * Fallback: Anthropic Messages API.
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key + anthropic-version: 2023-06-01
 *   Model:    claude-opus-4-7
 */

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-opus-4-7";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiResult {
  provider: "nvidia" | "anthropic";
  model: string;
  text: string;
}

export interface AiError {
  provider: string;
  status?: number;
  message: string;
}

// Per-Provider Timeout in ms — Wochenplaene brauchen lange (große Antworten 6000 tokens).
// Anthropic > Nvidia, aber beide muessen ueber typischer Generation-Zeit liegen.
const NVIDIA_TIMEOUT_MS = 90_000;
const ANTHROPIC_TIMEOUT_MS = 150_000;

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason));
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function callNvidia(messages: AiMessage[], maxTokens = 2500): Promise<AiResult> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw { provider: "nvidia", message: "NVIDIA_API_KEY not configured" } as AiError;
  const t = withTimeout(undefined, NVIDIA_TIMEOUT_MS);
  try {
    const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.5,
        top_p: 0.9,
        stream: false,
      }),
      signal: t.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw { provider: "nvidia", status: res.status, message: body.slice(0, 500) } as AiError;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw { provider: "nvidia", message: "Empty completion" } as AiError;
    return { provider: "nvidia", model: NVIDIA_MODEL, text };
  } catch (err) {
    if ((err as Error).name === "AbortError" || (err as Error).message?.includes("timeout")) {
      throw { provider: "nvidia", message: `timeout after ${NVIDIA_TIMEOUT_MS}ms` } as AiError;
    }
    throw err;
  } finally {
    t.cancel();
  }
}

async function callAnthropic(messages: AiMessage[], maxTokens = 2500): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw { provider: "anthropic", message: "ANTHROPIC_API_KEY not configured" } as AiError;

  const systemMsg = messages.find((m) => m.role === "system");
  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const t = withTimeout(undefined, ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_BASE, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: systemMsg?.content,
        messages: convo,
      }),
      signal: t.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw { provider: "anthropic", status: res.status, message: body.slice(0, 500) } as AiError;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) throw { provider: "anthropic", message: "Empty completion" } as AiError;
    return { provider: "anthropic", model: ANTHROPIC_MODEL, text };
  } catch (err) {
    if ((err as Error).name === "AbortError" || (err as Error).message?.includes("timeout")) {
      throw { provider: "anthropic", message: `timeout after ${ANTHROPIC_TIMEOUT_MS}ms` } as AiError;
    }
    throw err;
  } finally {
    t.cancel();
  }
}

/**
 * Versuche Nvidia, fallback Anthropic. Wirft kombinierte Errors falls beide fehlschlagen.
 */
export async function completeWithFallback(
  messages: AiMessage[],
  maxTokens = 2500,
): Promise<AiResult> {
  const errors: AiError[] = [];
  try {
    return await callNvidia(messages, maxTokens);
  } catch (err) {
    errors.push(err as AiError);
    console.error("[ai] Nvidia failed, trying Anthropic:", err);
  }
  try {
    return await callAnthropic(messages, maxTokens);
  } catch (err) {
    errors.push(err as AiError);
    console.error("[ai] Anthropic also failed:", err);
  }
  throw new Error(
    `Alle AI-Provider fehlgeschlagen: ${errors.map((e) => `${e.provider}: ${e.message}`).join(" | ")}`,
  );
}

/**
 * Anthropic-only. Fuer Use-Cases die zwingend strukturiertes/komplexes Reasoning brauchen
 * (Wochenplaner, tiefer Vergleich). Keine Nvidia-Fallback.
 */
export async function completeWithAnthropic(
  messages: AiMessage[],
  maxTokens = 4000,
): Promise<AiResult> {
  return callAnthropic(messages, maxTokens);
}

/**
 * Anthropic primary, Nvidia als Fallback. Fuer Use-Cases die normalerweise Anthropic-Qualitaet
 * brauchen (Wochenplaner), aber bei Anthropic-Ausfall (Credits leer, Rate-Limit, Outage)
 * nicht komplett fehlschlagen sollen.
 */
export async function completeWithAnthropicFirst(
  messages: AiMessage[],
  maxTokens = 4000,
): Promise<AiResult> {
  const errors: AiError[] = [];
  try {
    return await callAnthropic(messages, maxTokens);
  } catch (err) {
    errors.push(err as AiError);
    console.error("[ai] Anthropic failed, falling back to Nvidia:", err);
  }
  try {
    return await callNvidia(messages, maxTokens);
  } catch (err) {
    errors.push(err as AiError);
    console.error("[ai] Nvidia fallback also failed:", err);
  }
  throw new Error(
    `Alle AI-Provider fehlgeschlagen: ${errors.map((e) => `${e.provider}: ${e.message}`).join(" | ")}`,
  );
}
