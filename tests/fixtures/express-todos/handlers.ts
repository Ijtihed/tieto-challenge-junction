import { TodoStore } from "./store";

const store = new TodoStore();

export function getTodos() {
  return store.list();
}

export function addTodo(title: string) {
  return store.add(title);
}
