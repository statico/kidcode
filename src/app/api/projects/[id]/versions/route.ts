import { NextResponse } from "next/server";
import { listVersions, restoreVersion, snapshotProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const versions = listVersions(id);
  return NextResponse.json(versions);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const version = body.version as string;

  if (!version) {
    return NextResponse.json({ error: "Version required" }, { status: 400 });
  }

  // Snapshot current state before restoring so the restore itself is undoable
  snapshotProject(id);

  const success = restoreVersion(id, version);
  if (!success) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
