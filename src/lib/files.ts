import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

// --- Types ---

export type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  source: "manual" | "suggested";
  createdAt: string;
};

export type AppConfig = {
  ignoredRepos: string[];
};

// --- Paths ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate that a date string is a safe YYYY-MM-DD format (prevents path traversal). */
export function isValidDate(date: string): boolean {
  return DATE_RE.test(date);
}

export function getDataRoot(): string {
  const dir = process.env.LOGPILOT_DATA_DIR;
  if (!dir) return process.cwd();
  // Expand ~ to home directory
  if (dir.startsWith("~/") || dir === "~") {
    return path.join(process.env.HOME || "/", dir.slice(1));
  }
  return dir;
}

function dataRoot(): string {
  return getDataRoot();
}

const logsDir = () => path.join(dataRoot(), "logs");
const dataDir = () => path.join(dataRoot(), "data");

export function getLogPath(date: string): string {
  return path.join(logsDir(), `${date}.md`);
}

export function getRichLogPath(date: string): string {
  return path.join(logsDir(), `${date}.rich.md`);
}

export function getTodayDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// --- Directory bootstrapping ---

async function ensureDirs(): Promise<void> {
  await mkdir(logsDir(), { recursive: true });
  await mkdir(dataDir(), { recursive: true });
}

// --- Log I/O ---

export async function readLog(date: string): Promise<string> {
  try {
    return await readFile(getLogPath(date), "utf-8");
  } catch {
    return "";
  }
}

export async function writeLog(date: string, content: string): Promise<void> {
  await ensureDirs();
  await writeFile(getLogPath(date), content, "utf-8");
}

export async function readRichLog(date: string): Promise<string> {
  try {
    return await readFile(getRichLogPath(date), "utf-8");
  } catch {
    return "";
  }
}

export async function writeRichLog(
  date: string,
  content: string,
): Promise<void> {
  await ensureDirs();
  await writeFile(getRichLogPath(date), content, "utf-8");
}

// --- Todo I/O ---

function todosPath(): string {
  return path.join(dataDir(), "todos.json");
}

export async function readTodos(): Promise<TodoItem[]> {
  try {
    const raw = await readFile(todosPath(), "utf-8");
    return JSON.parse(raw) as TodoItem[];
  } catch {
    return [];
  }
}

export async function writeTodos(todos: TodoItem[]): Promise<void> {
  await ensureDirs();
  await writeFile(todosPath(), JSON.stringify(todos, null, 2), "utf-8");
}

// --- Config I/O ---

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

const defaultConfig: AppConfig = { ignoredRepos: [] };

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    return { ...defaultConfig, ...JSON.parse(raw) } as AppConfig;
  } catch {
    return { ...defaultConfig };
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await ensureDirs();
  await writeFile(configPath(), JSON.stringify(config, null, 2), "utf-8");
}
