from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class TodoCreate(BaseModel):
    title: str

todos = []

@app.get("/api/todos")
def list_todos():
    return todos

@app.post("/api/todos")
def create_todo(todo: TodoCreate):
    new_todo = {"id": len(todos) + 1, "title": todo.title}
    todos.append(new_todo)
    return new_todo

@app.get("/api/users")
def list_users():
    return [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
