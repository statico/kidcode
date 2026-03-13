import { NextResponse } from "next/server";
import { getProjectDir } from "@/lib/projects";
import fs from "fs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectDir = getProjectDir(id);

  if (!fs.existsSync(projectDir)) {
    return NextResponse.json([]);
  }

  const files = fs.readdirSync(projectDir).filter(
    (f) => !f.startsWith(".") && f !== "chat-history.json" && f !== "CLAUDE.md"
  );

  return NextResponse.json(files);
}
