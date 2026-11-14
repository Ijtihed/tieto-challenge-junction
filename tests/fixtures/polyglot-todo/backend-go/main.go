package main

import (
	"encoding/json"
	"net/http"
)

type Todo struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
}

var todos []Todo

func listTodos(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todos)
}

func createTodo(w http.ResponseWriter, r *http.Request) {
	var t Todo
	json.NewDecoder(r.Body).Decode(&t)
	t.ID = len(todos) + 1
	todos = append(todos, t)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(t)
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

func main() {
	http.HandleFunc("/api/todos", listTodos)
	http.HandleFunc("/api/todos/create", createTodo)
	http.HandleFunc("/health", healthCheck)
	http.ListenAndServe(":8080", nil)
}
