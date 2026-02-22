import { NextResponse } from "next/server";
import { readTodos, writeTodos, type TodoItem } from "@/lib/files";

export async function GET() {
  const todos = await readTodos();
  return NextResponse.json(todos);
}

export async function POST(req: Request) {
  const { title } = (await req.json()) as { title: string };
  if (!title || typeof title !== "string" || title.trim().length === 0 || title.length > 500) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  const todos = await readTodos();
  const item: TodoItem = {
    id: crypto.randomUUID(),
    title,
    done: false,
    source: "manual",
    createdAt: new Date().toISOString(),
  };
  todos.push(item);
  await writeTodos(todos);
  return NextResponse.json(todos);
}

export async function PUT(req: Request) {
  const { id, done, title, source } = (await req.json()) as {
    id: string;
    done?: boolean;
    title?: string;
    source?: "manual" | "suggested";
  };
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (done !== undefined) todo.done = done;
  if (title !== undefined) todo.title = title;
  if (source !== undefined) todo.source = source;
  await writeTodos(todos);
  return NextResponse.json(todos);
}

export async function DELETE(req: Request) {
  const { id } = (await req.json()) as { id: string };
  let todos = await readTodos();
  todos = todos.filter((t) => t.id !== id);
  await writeTodos(todos);
  return NextResponse.json(todos);
}
