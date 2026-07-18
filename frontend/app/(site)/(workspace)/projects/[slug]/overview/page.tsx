"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { get } from "@/app/utilities/api";
import type { ProjectOverview } from "@/app/utilities/tmux";
import { useWorkspace } from "@/app/utilities/workspace-context";
import ProjectOverviewPanel from "@/components/site/project-overview";

export default function ProjectOverviewPage() {
  const params = useParams<{ slug: string }>();
  const { getProjectBySlug } = useWorkspace();
  const project = getProjectBySlug(params.slug);
  const projectId = project?.id ?? null;

  const projectRef = useMemo(
    () => (project ? { id: project.id, name: project.name, server_id: project.server_id, root_path: project.root_path } : null),
    [project],
  );

  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await get(`/planning/projects/${id}/overview`);
      const data = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !data.ok) {
        setOverview(null);
        setError(data?.error ?? "Could not load project overview.");
        return;
      }
      setOverview({
        has_root: !!data.has_root,
        is_git: !!data.is_git,
        agents_md: data.agents_md ?? null,
        changed_files: data.changed_files ?? [],
      });
    } catch {
      setOverview(null);
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId === null) return;
    void loadOverview(projectId);
  }, [projectId, loadOverview]);

  return (
    <ProjectOverviewPanel
      project={projectRef}
      overview={overview}
      loading={loading}
      error={error}
      onRefresh={() => projectId !== null && void loadOverview(projectId)}
    />
  );
}
