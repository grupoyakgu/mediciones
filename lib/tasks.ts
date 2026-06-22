export interface Task {
  id: number;
  title: string;
  dueDate?: string;
  completed: boolean;
  createdAt: string;
}

let nextId = 1;
const tasks: Task[] = [];

export function addTask(title: string, dueDate?: string): Task {
  const task: Task = {
    id: nextId++,
    title,
    dueDate,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  return task;
}

export function listTasks(): Task[] {
  return [...tasks];
}

export function completeTask(id: number): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.completed = true;
  return true;
}

export function deleteTask(id: number): boolean {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}
