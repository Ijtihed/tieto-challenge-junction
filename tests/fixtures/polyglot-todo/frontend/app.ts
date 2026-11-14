import { fetchTodos, createTodo, fetchUsers } from "./api-client";

async function main() {
  const todos = await fetchTodos();
  console.log("Todos:", todos);

  const newTodo = await createTodo("Buy milk");
  console.log("Created:", newTodo);

  const users = await fetchUsers();
  console.log("Users:", users);
}

main();
