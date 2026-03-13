"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, X, Maximize2, Minimize2 } from "lucide-react";

interface PreviewPanelProps {
  projectId: string;
  previewFile: string;
  refreshKey: number;
  onClose: () => void;
}

export function PreviewPanel({ projectId, previewFile, refreshKey, onClose }: PreviewPanelProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);
  const previewUrl = `/api/projects/${projectId}/files/${previewFile}`;

  const handleRefresh = useCallback(() => {
    setManualRefresh((k) => k + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    window.open(previewUrl, "_blank");
  }, [previewUrl]);

  return (
    <div
      className={`flex flex-col border-l bg-background ${
        isMaximized ? "fixed inset-0 z-50" : "h-full"
      }`}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex-1 truncate text-xs text-muted-foreground font-mono">
          {previewUrl}
        </span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleRefresh} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleOpenExternal} title="Open in new tab">
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setIsMaximized(!isMaximized)}
          title={isMaximized ? "Minimize" : "Maximize"}
        >
          {isMaximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} title="Close preview">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 bg-white">
        <iframe
          key={`${refreshKey}-${manualRefresh}`}
          src={previewUrl}
          className="h-full w-full border-0"
          title="Project Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        />
      </div>
    </div>
  );
}
