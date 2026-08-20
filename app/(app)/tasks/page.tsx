import { currentDb } from '@/lib/session';
import { PageHeader } from '@/components/PageHeader';
import { TaskBoard } from '@/components/TaskBoard';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const db = await currentDb();
  const tasks = db.agentTasks.all();
  const agentNames = Object.fromEntries(db.agents.all().map((a) => [a.id, a.name]));
  return (
    <div>
      <PageHeader eyebrow="agent work" title="Tasks" />
      <TaskBoard initialTasks={tasks} agentNames={agentNames} />
    </div>
  );
}
