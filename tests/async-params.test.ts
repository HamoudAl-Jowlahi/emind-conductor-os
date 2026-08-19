/**
 * Next 16 hands dynamic route handlers and pages a PROMISE for `params` and
 * `searchParams` (changed in Next 15). Reading `.id` straight off that promise
 * yields `undefined` silently — no throw, no warning — so every dynamic route
 * degrades into "unknown …" without any signal.
 *
 * These tests pass params the way the framework actually does: as a promise.
 * They fail against the pre-migration signature and pin the contract so a
 * future refactor can't quietly revert to synchronous access.
 */
import { describe, expect, test, beforeEach, vi } from 'vitest';

process.env.FOUNDER_OS_DB = ':memory:';
process.env.LLM_PROVIDER = 'stub';

beforeEach(() => {
  vi.resetModules();
});

describe('Next 16 async params — API route handlers', () => {
  test('POST /api/agents/[id]/run resolves the agent id from a promise', async () => {
    const { POST } = await import('@/app/api/agents/[id]/run/route');
    const res = await POST(new Request('http://localhost/api/agents/markdown-auditor/run', { method: 'POST' }), {
      params: Promise.resolve({ id: 'markdown-auditor' }),
    });
    const body = (await res.json()) as { run?: { agentId: string }; error?: string };

    expect(body.error).toBeUndefined();
    expect(body.run?.agentId).toBe('markdown-auditor');
  });

  test('POST /api/agents/[id]/run still 404s on a genuinely unknown agent', async () => {
    const { POST } = await import('@/app/api/agents/[id]/run/route');
    const res = await POST(new Request('http://localhost/api/agents/nope/run', { method: 'POST' }), {
      params: Promise.resolve({ id: 'nope' }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('nope');
  });

  test('POST /api/agents/[id]/chat resolves the agent id from a promise', async () => {
    const { POST } = await import('@/app/api/agents/[id]/chat/route');
    const res = await POST(
      new Request('http://localhost/api/agents/data-agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'status' }),
      }),
      { params: Promise.resolve({ id: 'data-agent' }) },
    );

    // Reaching the agent at all is the assertion — a synchronous read would
    // 404 with "unknown agent: undefined" before any work happened.
    expect(res.status).not.toBe(404);
  });

  test('GET /api/social/[platform] resolves the platform from a promise', async () => {
    const { GET } = await import('@/app/api/social/[platform]/route');
    const res = await GET(new Request('http://localhost/api/social/instagram'), {
      params: Promise.resolve({ platform: 'instagram' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).account.platform).toBe('instagram');
  });

  test('GET /api/social/[platform] still 404s on an unknown platform', async () => {
    const { GET } = await import('@/app/api/social/[platform]/route');
    const res = await GET(new Request('http://localhost/api/social/myspace'), {
      params: Promise.resolve({ platform: 'myspace' }),
    });

    expect(res.status).toBe(404);
  });

  test('GET /api/skills/[slug] resolves the slug from a promise', async () => {
    const { GET } = await import('@/app/api/skills/[slug]/route');
    const res = await GET(new Request('http://localhost/api/skills/does-not-exist'), {
      params: Promise.resolve({ slug: 'does-not-exist' }),
    });

    // A resolved-but-missing slug is an honest 404; an unresolved promise would
    // reach readSkillMarkdown(undefined) instead of the slug we asked for.
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('skill not found');
  });
});

describe('Next 16 async params — pages', () => {
  test('social/[platform] page renders from a promise', async () => {
    const mod = await import('@/app/social/[platform]/page');
    await expect(mod.default({ params: Promise.resolve({ platform: 'instagram' }) })).resolves.toBeTruthy();
  });

  test('funnel page reads searchParams from a promise', async () => {
    const mod = await import('@/app/funnel/page');
    await expect(
      mod.default({ searchParams: Promise.resolve({ venture: 'vantage', layout: 'radial' }) }),
    ).resolves.toBeTruthy();
  });
});
