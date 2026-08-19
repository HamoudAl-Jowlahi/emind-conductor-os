import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { chat, llmStatus } from '@/lib/connectors/llm';

const KEY = 'AI_GATEWAY_API_KEY';
const prevKey = process.env[KEY];
const prevProvider = process.env.LLM_PROVIDER;

afterEach(() => {
  if (prevKey === undefined) delete process.env[KEY];
  else process.env[KEY] = prevKey;
  if (prevProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = prevProvider;
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
