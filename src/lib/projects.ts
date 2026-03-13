import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const PROJECTS_DIR = path.join(process.cwd(), "public", "projects");

function readProjects(): Project[] {
  try {
    const data = fs.readFileSync(PROJECTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function listProjects(): Project[] {
  return readProjects().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getProject(id: string): Project | undefined {
  return readProjects().find((p) => p.id === id);
}

export function createProject(name: string = "New Project"): Project {
  const projects = readProjects();
  const project: Project = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects.push(project);
  writeProjects(projects);

  // Create project directory
  const projectDir = path.join(PROJECTS_DIR, project.id);
  fs.mkdirSync(projectDir, { recursive: true });

  // Create CLAUDE.md to anchor the project root here
  fs.writeFileSync(
    path.join(projectDir, "CLAUDE.md"),
    "# Project\n\nWrite all files in this directory. Use index.html as the main entry point.\n"
  );

  // Initialize empty chat history
  saveChatHistory(project.id, []);

  return project;
}

export function updateProjectName(id: string, name: string): Project | undefined {
  const projects = readProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  project.name = name;
  project.updatedAt = new Date().toISOString();
  writeProjects(projects);
  return project;
}

export function touchProject(id: string): void {
  const projects = readProjects();
  const project = projects.find((p) => p.id === id);
  if (project) {
    project.updatedAt = new Date().toISOString();
    writeProjects(projects);
  }
}

export function getProjectDir(id: string): string {
  return path.join(PROJECTS_DIR, id);
}

export function getChatHistory(id: string): ChatMessage[] {
  const historyFile = path.join(getProjectDir(id), "chat-history.json");
  try {
    const data = fs.readFileSync(historyFile, "utf-8");
    return JSON.parse(data).messages || [];
  } catch {
    return [];
  }
}

export function saveChatHistory(id: string, messages: ChatMessage[]): void {
  const projectDir = getProjectDir(id);
  fs.mkdirSync(projectDir, { recursive: true });
  const historyFile = path.join(projectDir, "chat-history.json");
  fs.writeFileSync(historyFile, JSON.stringify({ messages }, null, 2));
}

export function appendChatMessage(id: string, message: ChatMessage): void {
  const messages = getChatHistory(id);
  messages.push(message);
  saveChatHistory(id, messages);
}

export function deleteProject(id: string): boolean {
  const projects = readProjects();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return false;
  projects.splice(index, 1);
  writeProjects(projects);
  // Remove project directory
  const projectDir = getProjectDir(id);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  return true;
}
