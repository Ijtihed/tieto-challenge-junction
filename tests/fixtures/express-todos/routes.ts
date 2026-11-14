import { getTodos, addTodo } from "./handlers";

export function todoRoutes(app: any) {
  app.get("/todos", getTodos);
  app.post("/todos", addTodo);
}
