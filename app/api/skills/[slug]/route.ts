import { NextResponse } from 'next/server';
import { readSkillMarkdown } from '@/lib/skills-catalog';

export const dynamic = 'force-dynamic';

/** The full SKILL.md for one real skill, loaded on demand by the reader. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const markdown = readSkillMarkdown(slug);
  if (markdown === null) return NextResponse.json({ error: 'skill not found' }, { status: 404 });
  return NextResponse.json({ markdown });
}
