"use client";

import { useCallback, useEffect, useState } from "react";

type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  source: "manual" | "suggested";
  createdAt: string;
};

export default function TodoList() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const fetchTodos = useCallback(async () => {
    const res = await fetch("/api/todos");
    setTodos(await res.json());
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const addTodo = async (title: string, source: "manual" | "suggested" = "manual") => {
    if (!title.trim()) return;
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    let updated: TodoItem[] = await res.json();
    if (source === "suggested" && updated.length > 0) {
      const last = updated[updated.length - 1];
      const putRes = await fetch("/api/todos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: last.id, source: "suggested" }),
      });
      updated = await putRes.json();
    }
    setTodos(updated);
    if (source === "manual") setInput("");
  };

  const toggleTodo = async (id: string, done: boolean) => {
    const res = await fetch("/api/todos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    });
    setTodos(await res.json());
  };

  const deleteTodo = async (id: string) => {
    const res = await fetch("/api/todos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setTodos(await res.json());
  };

  const suggest = async () => {
    setSuggesting(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/todos/suggest", { method: "POST" });
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } finally {
      setSuggesting(false);
    }
  };

  const dismissSuggestion = (title: string) => {
    setSuggestions((prev) => prev.filter((s) => s !== title));
  };

  const acceptSuggestion = (title: string) => {
    setSuggestions((prev) => prev.filter((s) => s !== title));
    addTodo(title, "suggested");
  };

  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-700">✅ TODO List</h2>
        <button
          onClick={suggest}
          disabled={suggesting}
          className="rounded-lg bg-violet-500 px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-600 disabled:opacity-50"
        >
          {suggesting ? "Thinking… 🤔" : "✨ Suggest TODOs"}
        </button>
      </div>

      {/* Add input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTodo(input);
        }}
        className="mb-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a todo…"
          className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200"
        >
          Add
        </button>
      </form>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
          <p className="mb-2 text-xs font-semibold text-violet-600">
            ✨ AI Suggestions — click to add
          </p>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s} className="flex items-center gap-1">
                <button
                  onClick={() => acceptSuggestion(s)}
                  className="flex-1 rounded px-2 py-1 text-left text-sm text-zinc-700 transition hover:bg-violet-100"
                >
                  + {s}
                </button>
                <button
                  onClick={() => dismissSuggestion(s)}
                  className="shrink-0 rounded px-1.5 py-1 text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-rose-500"
                  aria-label="Dismiss suggestion"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Todo list */}
      {todos.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">No todos yet. Add one above! 🎯</p>
      ) : (
        <ul className="space-y-1">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-zinc-50 ${
                todo.done ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => toggleTodo(todo.id, !todo.done)}
                className="h-4 w-4 accent-violet-500"
              />
              <span
                className={`flex-1 text-sm text-zinc-700 ${
                  todo.done ? "line-through" : ""
                }`}
              >
                {todo.title}
              </span>
              {todo.source === "suggested" && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                  AI
                </span>
              )}
              <button
                onClick={() => deleteTodo(todo.id)}
                className="text-zinc-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                aria-label="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
