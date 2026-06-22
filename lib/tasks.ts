export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: Date;
}

const tasks: Task[] = [];

export function createTask(title: string): Task {
  const task: Task = { id: crypto.randomUUID(), title, done: false, createdAt: new Date() };
  tasks.push(task);
  return task;
}

export function listTasks(): Task[] {
  return [...tasks];
}

export function completeTask(id: string): Task | undefined {
  const task = tasks.find((t) => t.id === id);
  if (task) task.done = true;
  return task;
}

export function deleteTask(id: string): boolean {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}
