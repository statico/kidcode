"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, MessageSquare, Trash2 } from "lucide-react";

export interface ProjectItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface SidebarProps {
  projects: ProjectItem[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  onDeleteProject,
}: SidebarProps) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
      <div className="flex items-center justify-between p-4">
        <h1 className="text-lg font-bold">KidCode</h1>
        <Button size="icon" variant="ghost" onClick={onNewProject} title="New Project">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-2">
          {projects.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No projects yet. Start a new one!
            </p>
          )}
          {projects.map((project) => (
            <div
              key={project.id}
              className={`group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors ${
                activeProjectId === project.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
              onClick={() => onSelectProject(project.id)}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{project.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className={`h-6 w-6 opacity-0 group-hover:opacity-100 ${
                  activeProjectId === project.id
                    ? "hover:bg-primary-foreground/20 text-primary-foreground"
                    : "hover:bg-destructive/10 text-destructive"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete "${project.name}"?`)) {
                    onDeleteProject(project.id);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
