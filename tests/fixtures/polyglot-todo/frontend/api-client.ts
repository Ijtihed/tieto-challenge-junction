const API_BASE = "http://localhost:8000";

export async function fetchTodos(): Promise<{ id: number; title: string }[]> {
  const res = await fetch(`${API_BASE}/api/todos`);
  return res.json();
}

export async function createTodo(title: string): Promise<{ id: number; title: string }> {
  const res = await fetch(`${API_BASE}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function fetchUsers(): Promise<{ id: number; name: string }[]> {
  const res = await fetch(`${API_BASE}/api/users`);
  return res.json();
}
