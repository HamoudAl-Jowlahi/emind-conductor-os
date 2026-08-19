import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { chat, getLlmProvider, llmStatus } from '@/lib/connectors/llm';

const KEY = 'AI_GATEWAY_API_KEY';
const GKEY = 'GOOGLE_API_KEY';
const prevKey = process.env[KEY];
const prevGKey = process.env[GKEY];
const prevProvider = process.env.LLM_PROVIDER;

const restore = (name: string, prev: string | undefined) => {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
};

afterEach(() => {
  restore(KEY, prevKey);
  restore(GKEY, prevGKey);
  restore('LLM_PROVIDER', prevProvider);
  vi.restoreAllMocks();
});

describe('llmStatus — honest connector state', () => {
  test('not_configured when no gateway key is present', async () => {
    delete process.env[KEY];
    const status = await llmStatus();
    expect(status.state).toBe('not_configured');
    expect(status.kind).toBe('orchestration');
    expect(status.id).toBe('llm');
  });

  test('connected when the key has usable credit', async () => {
    process.env[KEY] = 'test-gateway-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ balance: '4.20', total_used: '0.80' }), { status: 200 }),
    );
    const status = await llmStatus();
    expect(status.state).toBe('connected');
    expect(status.detail.length).toBeGreaterThan(0);
  });

  /**
   * A key alone proves nothing — Vercel refuses to serve requests until a card
   * unlocks the free credits, and the balance reads "0" until then. Reporting
   * `connected` there is exactly the fake green light this project forbids:
   * the board would look healthy while every agent chat failed.
   */
  test('error, not connected, when the key is valid but the balance is zero', async () => {
    process.env[KEY] = 'test-gateway-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ balance: '0', total_used: '0' }), { status: 200 }),
    );
    const status = await llmStatus();
    expect(status.state).toBe('error');
    expect(status.detail).toMatch(/credit/i);
  });

  test('error when the gateway rejects the key', async () => {
    process.env[KEY] = 'bad-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const status = await llmStatus();
    expect(status.state).toBe('error');
  });

  test('a network failure degrades to error, never to a fake connected', async () => {
    process.env[KEY] = 'test-gateway-key';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const status = await llmStatus();
    expect(status.state).toBe('error');
  });
});

describe('stub provider chat — deterministic, no network', () => {
  test('echoes the last user message and makes no network call', async () => {
    process.env.LLM_PROVIDER = 'stub';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await chat({ messages: [{ role: 'user', content: 'hello there' }] });
    expect(res.text).toContain('hello there');
    expect(res.toolCalls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('executes a tool when the prompt carries the trigger token', async () => {
    process.env.LLM_PROVIDER = 'stub';
    let calledWith: unknown = 'NOT_CALLED';
    const res = await chat({
      messages: [{ role: 'user', content: 'use-tool:lookup find the thing' }],
      tools: [
        {
          name: 'lookup',
          description: 'look something up',
          parameters: z.object({}),
          execute: async (args) => {
            calledWith = args;
            return { ok: true, value: 42 };
          },
        },
      ],
    });
    expect(calledWith).not.toBe('NOT_CALLED');
    expect(res.toolCalls.map((c) => c.name)).toContain('lookup');
    expect(res.toolCalls[0].result).toEqual({ ok: true, value: 42 });
  });
});

/**
 * The Vercel gateway will not serve a request until a card unlocks its free
 * credits. Google AI Studio has no such gate, so `LLM_PROVIDER=google` is the
 * escape hatch for anyone who cannot or will not put a card on file. It is a
 * peer of the gateway, not a replacement: same LlmProvider shape, same tool
 * contract, selected purely by env.
 */
describe('google provider — the no-credit-card path', () => {
  test('LLM_PROVIDER=google selects it, and it is not the gateway', () => {
    process.env.LLM_PROVIDER = 'google';
    process.env[GKEY] = 'test-google-key';
    expect(getLlmProvider().name).toBe('google');
  });

  test('not_configured when the provider is google but no key is set', async () => {
    process.env.LLM_PROVIDER = 'google';
    delete process.env[GKEY];
    const status = await llmStatus();
    expect(status.state).toBe('not_configured');
    expect(status.detail).toMatch(/GOOGLE_API_KEY/);
  });

  test('connected when Google answers the model listing', async () => {
    process.env.LLM_PROVIDER = 'google';
    process.env[GKEY] = 'test-google-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.6-flash' }] }), { status: 200 }),
    );
    const status = await llmStatus();
    expect(status.state).toBe('connected');
    expect(status.detail).toMatch(/gemini/i);
  });

  test('error when Google rejects the key — never a fake connected', async () => {
    process.env.LLM_PROVIDER = 'google';
    process.env[GKEY] = 'bad-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 403 }));
    const status = await llmStatus();
    expect(status.state).toBe('error');
  });
});
