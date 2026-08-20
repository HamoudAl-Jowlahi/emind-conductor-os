/**
 * LLM connector — backs agent & Conductor chat.
 *
 * Mirrors the brain.ts provider shape. Three providers, chosen by LLM_PROVIDER:
 *   gateway (default) — Vercel AI Gateway, "provider/model" strings. Note it
 *     refuses every request until a card unlocks its free credits.
 *   google            — Google AI Studio. No billing gate, so this is the
 *     path when a card is not an option. Same tool contract.
 *   stub              — deterministic, makes NO network call, so the whole
 *     agent-chat stack stays testable offline.
 *
 * Status stays honest for all three: a key that cannot actually serve reports
 * `error` with the real reason, never a fake "connected".
 */
import { z } from 'zod';
import { CRED_FILES, resolveCred, runtimeEnv } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';
export type LlmMessage = { role: LlmRole; content: string };

export type LlmToolSpec = {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export type LlmToolCall = { name: string; args: unknown; result: unknown };

export type LlmChatRequest = {
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  model?: string;
};

export type LlmChatResult = { text: string; toolCalls: LlmToolCall[] };

export interface LlmProvider {
  name: string;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

const GATEWAY_KEY = 'AI_GATEWAY_API_KEY';
const DEFAULT_MODEL = process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-5';

/** Google AI Studio: no card required, unlike the Vercel gateway. */
const GOOGLE_DEFAULT_MODEL = process.env.GOOGLE_MODEL ?? 'gemini-3.6-flash';
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** GOOGLE_API_KEY, or GEMINI_API_KEY for anyone who names it that way. */
function resolveGoogleKey(): string | undefined {
  return (
    resolveCred('GOOGLE_API_KEY', [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]) ??
    resolveCred('GEMINI_API_KEY', [CRED_FILES.agentsEnv, CRED_FILES.socialMedia])
  );
}

/** process.env first (Next auto-loads .env.local), then Alex's cred files. */
function resolveGatewayKey(): string | undefined {
  return resolveCred(GATEWAY_KEY, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

/** Stub trigger: a user message containing `use-tool:<name>` fires that tool. */
const STUB_TRIGGER = /use-tool:(\S+)/;

export const stubLlmProvider: LlmProvider = {
  name: 'stub',
  async chat(req) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser ? `stub-reply: ${lastUser.content}` : 'stub-reply';
    const toolCalls: LlmToolCall[] = [];
    const trigger = lastUser?.content.match(STUB_TRIGGER);
    if (trigger && req.tools) {
      const spec = req.tools.find((t) => t.name === trigger[1]);
      if (spec) {
        const args: Record<string, unknown> = {};
        const result = await spec.execute(args);
        toolCalls.push({ name: spec.name, args, result });
      }
    }
    return { text, toolCalls };
  },
};

export function createGatewayProvider(model: string = DEFAULT_MODEL): LlmProvider {
  return {
    name: 'gateway',
    async chat(req) {
      // Fail fast with an honest message instead of letting the SDK hang —
      // and hydrate process.env from Alex's cred files so a key that
      // exists outside .env.local still works.
      const key = resolveGatewayKey();
      if (!key) {
        throw new Error('AI_GATEWAY_API_KEY is not set — add it to .env.local to enable agent chat.');
      }
      if (!process.env.AI_GATEWAY_API_KEY) process.env.AI_GATEWAY_API_KEY = key;
      const { generateText, tool, stepCountIs, gateway } = await import('ai');
      const tools = Object.fromEntries(
        (req.tools ?? []).map((t) => [
          t.name,
          tool({ description: t.description, inputSchema: t.parameters, execute: t.execute }),
        ]),
      );
      const messages = req.messages
        .filter((m) => m.role !== 'tool')
        .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

      const result = await generateText({
        model: gateway(req.model ?? model),
        system: req.system,
        messages,
        tools: req.tools?.length ? tools : undefined,
        stopWhen: stepCountIs(6),
      });

      const toolCalls: LlmToolCall[] = [];
      for (const step of result.steps ?? []) {
        const calls = step.toolCalls ?? [];
        const results = step.toolResults ?? [];
        for (const c of calls) {
          // Match the result to its call by id — a failed/missing tool result
          // can leave `toolResults` shorter than `toolCalls`, so positional
          // alignment would attach the wrong output to every later call.
          const hit = results.find((r) => r.toolCallId === c.toolCallId);
          toolCalls.push({ name: c.toolName, args: c.input, result: hit?.output });
        }
      }
      return { text: result.text, toolCalls };
    },
  };
}

/**
 * Google AI Studio provider — the no-credit-card path.
 *
 * Same shape and same tool contract as the gateway provider; only the model
 * binding differs, so `chatTools()` keeps working untouched. Reaches for the
 * official @ai-sdk/google adapter rather than hand-rolling the REST call,
 * which is what keeps multi-step tool use identical across providers.
 */
export function createGoogleProvider(model: string = GOOGLE_DEFAULT_MODEL): LlmProvider {
  return {
    name: 'google',
    async chat(req) {
      const key = resolveGoogleKey();
      if (!key) {
        throw new Error('GOOGLE_API_KEY is not set — add it to .env.local to enable agent chat.');
      }
      const { generateText, tool, stepCountIs } = await import('ai');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const google = createGoogleGenerativeAI({ apiKey: key });

      const tools = Object.fromEntries(
        (req.tools ?? []).map((t) => [
          t.name,
          tool({ description: t.description, inputSchema: t.parameters, execute: t.execute }),
        ]),
      );
      const messages = req.messages
        .filter((m) => m.role !== 'tool')
        .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

      const result = await generateText({
        model: google(req.model ?? model),
        system: req.system,
        messages,
        tools: req.tools?.length ? tools : undefined,
        stopWhen: stepCountIs(6),
      });

      const toolCalls: LlmToolCall[] = [];
      for (const step of result.steps ?? []) {
        const calls = step.toolCalls ?? [];
        const results = step.toolResults ?? [];
        for (const c of calls) {
          // Match by id, not position — a failed tool result leaves the arrays
          // different lengths and positional pairing attaches the wrong output.
          const hit = results.find((r) => r.toolCallId === c.toolCallId);
          toolCalls.push({ name: c.toolName, args: c.input, result: hit?.output });
        }
      }
      return { text: result.text, toolCalls };
    },
  };
}

/**
 * Which provider is active. Reads the fresh .env.local overlay, not just
 * process.env: keys already resolve that way, so selecting a provider had to
 * as well — otherwise pasting LLM_PROVIDER=google took a server restart while
 * the key beside it took effect immediately.
 */
export function llmProviderName(): string {
  return runtimeEnv().LLM_PROVIDER ?? 'gateway';
}

export function getLlmProvider(): LlmProvider {
  const name = llmProviderName();
  if (name === 'stub') return stubLlmProvider;
  if (name === 'google') return createGoogleProvider();
  return createGatewayProvider();
}

export function chat(req: LlmChatRequest): Promise<LlmChatResult> {
  return getLlmProvider().chat(req);
}

const CREDITS_URL = 'https://ai-gateway.vercel.sh/v1/credits';
const CREDITS_TIMEOUT_MS = 4000;

/**
 * A key on disk proves nothing. The gateway refuses to serve requests until a
 * card unlocks the free credits, and until then every model call fails while
 * the balance reads "0" — so key-presence alone would light the board green
 * while every agent chat died. This asks the gateway for the real balance and
 * reports what it finds. Cheap (one small GET), bounded by a timeout, and
 * degrades to `error` rather than to a comfortable lie.
 */
export async function llmStatus(): Promise<ConnectorStatus> {
  const base = { id: 'llm', name: 'LLM (Gateway)', kind: 'orchestration' } as const;
  const provider = llmProviderName();
  if (provider === 'stub') {
    return { ...base, state: 'connected', detail: 'stub provider active (tests)' };
  }

  // Google AI Studio has no billing gate, so presence of a working key is the
  // whole story — but "working" still has to be asked, not assumed.
  if (provider === 'google') {
    const gkey = resolveGoogleKey();
    if (!gkey) {
      return {
        ...base,
        state: 'not_configured',
        detail: 'Set GOOGLE_API_KEY in Connections to enable agent chat via Google AI Studio.',
      };
    }
    try {
      const res = await fetch(GOOGLE_MODELS_URL, {
        headers: { 'x-goog-api-key': gkey },
        signal: AbortSignal.timeout(CREDITS_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ...base, state: 'error', detail: `Google rejected the key (HTTP ${res.status}) — check GOOGLE_API_KEY.` };
      }
      return {
        ...base,
        state: 'connected',
        detail: `Google AI Studio · default model ${GOOGLE_DEFAULT_MODEL}`,
        meta: { provider: 'google', model: GOOGLE_DEFAULT_MODEL },
      };
    } catch (err) {
      return { ...base, state: 'error', detail: `Google unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const key = resolveGatewayKey();
  if (!key) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Set AI_GATEWAY_API_KEY in Connections to enable agent chat via the Vercel AI Gateway.',
    };
  }

  try {
    const res = await fetch(CREDITS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CREDITS_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ...base,
        state: 'error',
        detail: `Gateway rejected the key (HTTP ${res.status}) — check AI_GATEWAY_API_KEY.`,
      };
    }
    const body = (await res.json()) as { balance?: string; total_used?: string };
    const balance = Number(body.balance ?? '0');
    if (!Number.isFinite(balance) || balance <= 0) {
      return {
        ...base,
        state: 'error',
        detail:
          'Key valid but the credit balance is 0 — Vercel needs a card on file to unlock the free credits before it will serve any request.',
        meta: { balance: body.balance ?? '0' },
      };
    }
    return {
      ...base,
      state: 'connected',
      detail: `Vercel AI Gateway · default model ${DEFAULT_MODEL} · balance ${body.balance}`,
      meta: { balance: body.balance ?? '', used: body.total_used ?? '' },
    };
  } catch (err) {
    return {
      ...base,
      state: 'error',
      detail: `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
