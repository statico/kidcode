"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useQueryState } from "nuqs";
import { Sidebar, ProjectItem } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { useChat } from "@/hooks/use-chat";

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useQueryState("project");
  const [showPreview, setShowPreview] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewFile, setPreviewFile] = useState<string>("index.html");
  const [hasVersions, setHasVersions] = useState(false);

  const handleTitle = useCallback(
    async (title: string) => {
      if (!activeProjectId) return;
      await fetch(`/api/projects/${activeProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: title }),
      });
      setProjects((prev) =>
        prev.map((p) => (p.id === activeProjectId ? { ...p, name: title } : p))
      );
    },
    [activeProjectId]
  );

  const handleFileChange = useCallback((fileName: string) => {
    if (fileName.endsWith(".html")) {
      setPreviewFile(fileName);
    }
    setShowPreview(true);
    setPreviewRefreshKey((k) => k + 1);
    setHasVersions(true);
  }, []);

  const chat = useChat({
    projectId: activeProjectId || "",
    onTitle: handleTitle,
    onFileChange: handleFileChange,
  });

  // Load projects on mount
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  // Load chat history and check for existing files when project changes
  useEffect(() => {
    if (activeProjectId) {
      chat.loadHistory();
      setShowPreview(false);
      setPreviewRefreshKey(0);
      setPreviewFile("index.html");

      // Check for versions
      fetch(`/api/projects/${activeProjectId}/versions`)
        .then((r) => r.json())
        .then((versions: string[]) => setHasVersions(versions.length > 0))
        .catch(() => setHasVersions(false));

      // Check if project has HTML files to preview
      fetch(`/api/projects/${activeProjectId}/files`)
        .then((r) => r.json())
        .then((files: string[]) => {
          const htmlFile = files.find((f: string) => f.endsWith(".html"));
          if (htmlFile) {
            setPreviewFile(htmlFile);
            setShowPreview(true);
            setPreviewRefreshKey((k) => k + 1);
          }
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const handleNewProject = async () => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Project" }),
    });
    const project = await res.json();
    setProjects((prev) => [project, ...prev]);
    setActiveProjectId(project.id);
    chat.setMessages([]);
    setShowPreview(false);
    setPreviewFile("index.html");
  };

  const handleDeleteProject = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      chat.setMessages([]);
      setShowPreview(false);
    }
  };

  const handleUndo = async () => {
    if (!activeProjectId) return;
    const versionsRes = await fetch(`/api/projects/${activeProjectId}/versions`);
    const versions = await versionsRes.json();
    if (versions.length === 0) return;

    const res = await fetch(`/api/projects/${activeProjectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: versions[0] }),
    });
    if (res.ok) {
      setPreviewRefreshKey((k) => k + 1);
      // Re-check versions
      const updatedRes = await fetch(`/api/projects/${activeProjectId}/versions`);
      const updatedVersions = await updatedRes.json();
      setHasVersions(updatedVersions.length > 0);
    }
  };

  const handleSelectProject = (id: string) => {
    if (id !== activeProjectId) {
      setActiveProjectId(id);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
        onDeleteProject={handleDeleteProject}
      />
      <div className="flex flex-1 overflow-hidden">
        {activeProjectId ? (
          <>
            <div className={`flex-1 overflow-hidden ${showPreview ? "w-1/2" : ""}`}>
              <ChatPanel
                messages={chat.messages}
                isLoading={chat.isLoading}
                activity={chat.activity}
                hasVersions={hasVersions}
                onSend={chat.sendMessage}
                onStop={chat.stop}
                onUndo={handleUndo}
              />
            </div>
            {showPreview && (
              <div className="w-1/2 overflow-hidden">
                <PreviewPanel
                  projectId={activeProjectId}
                  previewFile={previewFile}
                  refreshKey={previewRefreshKey}
                  onClose={() => setShowPreview(false)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">KidCode</h2>
              <p className="text-muted-foreground mb-6">
                Build cool stuff with AI! Start a new project to begin.
              </p>
              <button
                onClick={handleNewProject}
                className="rounded-xl bg-primary px-6 py-3 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Start a New Project
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
