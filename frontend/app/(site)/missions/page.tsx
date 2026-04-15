"use client";

import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Ellipsis,
  LoaderCircle,
  PencilLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, post, put } from "../../utilities/api";
import Modal from "@/components/site/modal";

type AuthState = "checking" | "authenticated" | "guest";
type BusyMissionAction = "delete" | "update" | "step_create" | "reorder";
type BusyStepAction = "next" | "delete" | "update" | "reorder";

type MissionStep = {
  id: number;
  title: string;
  description: string | null;
  is_next: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

type Mission = {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  steps: MissionStep[];
};

type PendingConfirmation =
  | { kind: "delete_mission"; mission: Mission }
  | { kind: "delete_step"; step: MissionStep }
  | null;

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

const SESSION_COOKIE_KEY = "planning_session";
const MISSION_CARD_ACTIONS_VISIBILITY_CLASS =
  "md:invisible md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover/mission:visible md:group-hover/mission:opacity-100 md:group-hover/mission:pointer-events-auto";
const STEP_CARD_ACTIONS_VISIBILITY_CLASS =
  "md:invisible md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover/step:visible md:group-hover/step:opacity-100 md:group-hover/step:pointer-events-auto";

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function hasSessionCookie() {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${SESSION_COOKIE_KEY}=`));
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedOptionalText(value: string) {
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function sortSteps(items: MissionStep[]) {
  return [...items].sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position;
    return left.created_at.localeCompare(right.created_at);
  });
}

function sortMissions(items: Mission[]) {
  return [...items]
    .map((mission) => ({ ...mission, steps: sortSteps(mission.steps) }))
    .sort((left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      return left.created_at.localeCompare(right.created_at);
    });
}

function MetaItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ color: "var(--foreground-muted)" }}>{icon}</span>
      <span>{children}</span>
    </span>
  );
}

function ActionMenuButton({
  title,
  isOpen,
  onClick,
}: {
  title: string;
  isOpen: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      aria-expanded={isOpen}
      className="flex h-9 w-9 items-center justify-center rounded-full border transition"
      style={{
        borderColor: isOpen
          ? "color-mix(in srgb, var(--accent) 18%, transparent)"
          : "color-mix(in srgb, var(--card-border) 62%, transparent)",
        backgroundColor: isOpen
          ? "color-mix(in srgb, var(--accent-tint) 62%, transparent)"
          : "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
        color: isOpen ? "var(--accent)" : "var(--foreground-muted)",
      }}
    >
      <Ellipsis className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function ActionMenuItem({
  children,
  onClick,
  tone = "default",
  disabled = false,
}: {
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm transition disabled:opacity-60"
      style={
        tone === "danger"
          ? {
              color: "var(--danger)",
              backgroundColor: "color-mix(in srgb, var(--danger-tint) 34%, transparent)",
            }
          : {
              color: "var(--foreground)",
              backgroundColor: "transparent",
            }
      }
    >
      {children}
    </button>
  );
}

function ActionMenu({
  menuKey,
  openMenuKey,
  onToggle,
  children,
}: {
  menuKey: string;
  openMenuKey: string | null;
  onToggle: (menuKey: string) => void;
  children: ReactNode;
}) {
  const isOpen = openMenuKey === menuKey;

  return (
    <div data-action-menu-root className="relative">
      <ActionMenuButton
        title="Open actions"
        isOpen={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(menuKey);
        }}
      />
      {isOpen ? (
        <div
          className="surface-card absolute right-0 top-11 z-20 w-52 rounded-[24px] p-2 shadow-[var(--shadow-4)]"
          style={{ border: "1px solid color-mix(in srgb, var(--card-border) 72%, transparent)" }}
        >
          <div className="space-y-1">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function GuestHome() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <main className="grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
          <span
            className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            Mission planning
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Keep mission priorities clear and actionable.</h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Define missions, break them into steps, choose one next step per mission, and reorder anytime.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="button-primary rounded-full px-5 py-3 text-sm font-semibold">
              Sign in to your workspace
            </Link>
            <Link href="/login" className="button-secondary rounded-full px-5 py-3 text-sm font-semibold">
              Create an account
            </Link>
          </div>
        </section>

        <aside className="surface-card rounded-[28px] p-6 sm:p-7">
          <p className="text-sm font-semibold">Workspace preview</p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            Missions with ordered steps.
          </p>
          <div className="mt-6 space-y-3">
            <article className="surface-subtle rounded-3xl p-4">
              <p className="font-medium">1. Launch paid pilot</p>
            </article>
            <article className="surface-subtle rounded-3xl p-4">
              <p className="text-sm font-semibold">Next step</p>
              <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                Run five customer calls and summarize objections.
              </p>
            </article>
          </div>
        </aside>
      </main>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-56 rounded-xl" />
      <div className="skeleton h-28 rounded-[28px]" />
      <div className="skeleton h-28 rounded-[28px]" />
      <div className="skeleton h-28 rounded-[28px]" />
    </div>
  );
}

function ActionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="h-3.5 w-3.5" aria-hidden="true" />;
}

export default function MissionsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [isCreateMissionOpen, setIsCreateMissionOpen] = useState(false);
  const [createMissionTitle, setCreateMissionTitle] = useState("");
  const [createMissionDescription, setCreateMissionDescription] = useState("");
  const [isCreateMissionSubmitting, setIsCreateMissionSubmitting] = useState(false);

  const [createStepMission, setCreateStepMission] = useState<Mission | null>(null);
  const [createStepTitle, setCreateStepTitle] = useState("");
  const [createStepDescription, setCreateStepDescription] = useState("");
  const [createStepIsNext, setCreateStepIsNext] = useState(false);

  const [busyMissionId, setBusyMissionId] = useState<number | null>(null);
  const [busyMissionAction, setBusyMissionAction] = useState<BusyMissionAction | null>(null);
  const [busyStepId, setBusyStepId] = useState<number | null>(null);
  const [busyStepAction, setBusyStepAction] = useState<BusyStepAction | null>(null);

  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [editMissionTitle, setEditMissionTitle] = useState("");
  const [editMissionDescription, setEditMissionDescription] = useState("");
  const [isMissionEditSubmitting, setIsMissionEditSubmitting] = useState(false);

  const [editingStep, setEditingStep] = useState<MissionStep | null>(null);
  const [editStepTitle, setEditStepTitle] = useState("");
  const [editStepDescription, setEditStepDescription] = useState("");
  const [editStepIsNext, setEditStepIsNext] = useState(false);
  const [isStepEditSubmitting, setIsStepEditSubmitting] = useState(false);

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimeoutsRef = useRef<number[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (type: ToastMessage["type"], message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current, { id, type, message }]);

      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
        toastTimeoutsRef.current = toastTimeoutsRef.current.filter((storedId) => storedId !== timeoutId);
      }, 4000);

      toastTimeoutsRef.current.push(timeoutId);
    },
    [dismissToast],
  );

  useEffect(() => {
    return () => {
      toastTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      toastTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const menuRoot = target.closest("[data-action-menu-root]");
      if (menuRoot) return;
      setOpenMenuKey(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const loadMissions = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await get("/planning/missions");

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as Mission[];
      setMissions(sortMissions(data));
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load missions");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasSessionCookie() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadMissions();
  }, [authState, loadMissions]);

  const orderedMissions = useMemo(() => sortMissions(missions), [missions]);
  const totalStepsCount = useMemo(() => orderedMissions.reduce((sum, mission) => sum + mission.steps.length, 0), [orderedMissions]);
  const nextStepsCount = useMemo(
    () => orderedMissions.reduce((sum, mission) => sum + (mission.steps.some((step) => step.is_next) ? 1 : 0), 0),
    [orderedMissions],
  );

  function replaceMission(updatedMission: Mission) {
    setMissions((current) => sortMissions(current.map((mission) => (mission.id === updatedMission.id ? updatedMission : mission))));
  }

  async function updateMissionRecord(mission: Mission, position: number) {
    const response = await put(`/planning/missions/${mission.id}`, {
      title: mission.title,
      description: mission.description,
      position,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return (await response.json()) as Mission;
  }

  async function updateStepRecord(step: MissionStep, isNext: boolean, position: number) {
    const response = await put(`/planning/mission-steps/${step.id}`, {
      title: step.title,
      description: step.description,
      is_next: isNext,
      position,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return (await response.json()) as Mission;
  }

  async function handleMoveMission(mission: Mission, direction: "up" | "down") {
    const index = orderedMissions.findIndex((item) => item.id === mission.id);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= orderedMissions.length) return;

    const target = orderedMissions[targetIndex];
    setBusyMissionId(mission.id);
    setBusyMissionAction("reorder");

    try {
      await updateMissionRecord(mission, target.position);
      await updateMissionRecord(target, mission.position);
      await loadMissions();
      pushToast("success", "Mission order updated.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to reorder mission");
    } finally {
      setBusyMissionId(null);
      setBusyMissionAction(null);
    }
  }

  async function handleMoveStep(mission: Mission, step: MissionStep, direction: "up" | "down") {
    const orderedSteps = sortSteps(mission.steps);
    const index = orderedSteps.findIndex((item) => item.id === step.id);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= orderedSteps.length) return;

    const target = orderedSteps[targetIndex];

    setBusyStepId(step.id);
    setBusyStepAction("reorder");

    try {
      await updateStepRecord(step, step.is_next, target.position);
      const updatedMission = await updateStepRecord(target, target.is_next, step.position);
      replaceMission(updatedMission);
      pushToast("success", "Step order updated.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to reorder step");
    } finally {
      setBusyStepId(null);
      setBusyStepAction(null);
    }
  }

  function openCreateMissionModal() {
    setCreateMissionTitle("");
    setCreateMissionDescription("");
    setIsCreateMissionOpen(true);
  }

  function closeCreateMissionModal() {
    if (isCreateMissionSubmitting) return;
    setIsCreateMissionOpen(false);
  }

  function openCreateStepModal(mission: Mission) {
    setCreateStepMission(mission);
    setCreateStepTitle("");
    setCreateStepDescription("");
    setCreateStepIsNext(mission.steps.length === 0);
    setOpenMenuKey(null);
  }

  function openMissionEditor(mission: Mission) {
    setOpenMenuKey(null);
    setEditingMission(mission);
    setEditMissionTitle(mission.title);
    setEditMissionDescription(mission.description ?? "");
  }

  function closeMissionEditor(force = false) {
    if (!force && isMissionEditSubmitting) return;
    setEditingMission(null);
  }

  function openStepEditor(step: MissionStep) {
    setOpenMenuKey(null);
    setEditingStep(step);
    setEditStepTitle(step.title);
    setEditStepDescription(step.description ?? "");
    setEditStepIsNext(step.is_next);
  }

  function closeStepEditor(force = false) {
    if (!force && isStepEditSubmitting) return;
    setEditingStep(null);
  }

  async function handleCreateMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanedTitle = normalizedText(createMissionTitle);
    const cleanedDescription = normalizedOptionalText(createMissionDescription);
    if (!cleanedTitle) return;

    setIsCreateMissionSubmitting(true);

    try {
      const response = await post("/planning/missions", {
        title: cleanedTitle,
        description: cleanedDescription,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const createdMission = (await response.json()) as Mission;
      setMissions((current) => sortMissions([...current, createdMission]));
      setIsCreateMissionOpen(false);
      pushToast("success", "Mission created.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create mission");
    } finally {
      setIsCreateMissionSubmitting(false);
    }
  }

  async function handleCreateStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createStepMission) return;

    const cleanedTitle = normalizedText(createStepTitle);
    const cleanedDescription = normalizedOptionalText(createStepDescription);
    if (!cleanedTitle) return;

    setBusyMissionId(createStepMission.id);
    setBusyMissionAction("step_create");

    try {
      const response = await post(`/planning/missions/${createStepMission.id}/steps`, {
        title: cleanedTitle,
        description: cleanedDescription,
        is_next: createStepIsNext,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedMission = (await response.json()) as Mission;
      replaceMission(updatedMission);
      setCreateStepMission(null);
      pushToast("success", "Step created.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create step");
    } finally {
      setBusyMissionId(null);
      setBusyMissionAction(null);
    }
  }

  async function handleUpdateMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMission) return;

    const cleanedTitle = normalizedText(editMissionTitle);
    const cleanedDescription = normalizedOptionalText(editMissionDescription);
    if (!cleanedTitle) return;

    setIsMissionEditSubmitting(true);

    try {
      const response = await put(`/planning/missions/${editingMission.id}`, {
        title: cleanedTitle,
        description: cleanedDescription,
        position: editingMission.position,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedMission = (await response.json()) as Mission;
      replaceMission(updatedMission);
      closeMissionEditor(true);
      pushToast("success", "Mission updated.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update mission");
    } finally {
      setIsMissionEditSubmitting(false);
    }
  }

  async function handleDeleteMission(mission: Mission) {
    setBusyMissionId(mission.id);
    setBusyMissionAction("delete");

    try {
      const response = await del(`/planning/missions/${mission.id}`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setMissions((current) => current.filter((item) => item.id !== mission.id));
      setPendingConfirmation(null);
      setEditingMission(null);
      setOpenMenuKey(null);
      pushToast("success", "Mission removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove mission");
    } finally {
      setBusyMissionId(null);
      setBusyMissionAction(null);
    }
  }

  async function handleToggleNextStep(mission: Mission, step: MissionStep) {
    setBusyStepId(step.id);
    setBusyStepAction("next");

    try {
      const updatedMission = await updateStepRecord(step, !step.is_next, step.position);
      replaceMission(updatedMission);
      pushToast("success", step.is_next ? "Next step cleared." : `Next step set for ${mission.title}.`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update step");
    } finally {
      setBusyStepId(null);
      setBusyStepAction(null);
    }
  }

  async function handleUpdateStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStep) return;

    const cleanedTitle = normalizedText(editStepTitle);
    const cleanedDescription = normalizedOptionalText(editStepDescription);
    if (!cleanedTitle) return;

    setIsStepEditSubmitting(true);
    setBusyStepId(editingStep.id);
    setBusyStepAction("update");

    try {
      const response = await put(`/planning/mission-steps/${editingStep.id}`, {
        title: cleanedTitle,
        description: cleanedDescription,
        is_next: editStepIsNext,
        position: editingStep.position,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedMission = (await response.json()) as Mission;
      replaceMission(updatedMission);
      closeStepEditor(true);
      pushToast("success", "Step updated.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update step");
    } finally {
      setIsStepEditSubmitting(false);
      setBusyStepId(null);
      setBusyStepAction(null);
    }
  }

  async function handleDeleteStep(step: MissionStep) {
    setBusyStepId(step.id);
    setBusyStepAction("delete");

    try {
      const response = await del(`/planning/mission-steps/${step.id}`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPendingConfirmation(null);
      closeStepEditor(true);
      await loadMissions();
      pushToast("success", "Step removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove step");
    } finally {
      setBusyStepId(null);
      setBusyStepAction(null);
    }
  }

  if (authState === "checking") {
    return <DashboardLoadingState />;
  }

  if (authState === "guest") {
    return <GuestHome />;
  }

  const isConfirmationBusy = busyMissionAction === "delete" || busyStepAction === "delete";

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col">
      <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(92vw,380px)] flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-[24px] border px-4 py-3 shadow-[var(--shadow-4)] ${
              toast.type === "success" ? "notice-success" : "notice-error"
            }`}
            role={toast.type === "success" ? "status" : "alert"}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-6">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full px-2 py-1 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>

      <section className="px-1 pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-4xl flex-1">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Missions</h2>
            <p className="mt-1 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              Reorder missions and steps with simple up/down controls and keep one next step per mission.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
              <MetaItem icon={<BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" />}>{orderedMissions.length} missions</MetaItem>
              <MetaItem icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}>{totalStepsCount} total steps</MetaItem>
              <MetaItem icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}>{nextStepsCount} next steps selected</MetaItem>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateMissionModal}
            className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create mission
          </button>
        </div>
      </section>

      <section className="min-w-0 flex-1">
        {isLoading ? (
          <div className="space-y-3" aria-live="polite">
            <div className="skeleton h-28 rounded-[32px]" />
            <div className="skeleton h-28 rounded-[32px]" />
            <div className="skeleton h-28 rounded-[32px]" />
          </div>
        ) : orderedMissions.length === 0 ? (
          <div className="surface-card rounded-[32px] px-5 py-10 sm:px-6">
            <h3 className="text-lg font-semibold">No missions yet</h3>
            <p className="mt-2 max-w-xl text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              Create your first mission to start planning.
            </p>
            <button
              type="button"
              onClick={openCreateMissionModal}
              className="button-secondary mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create mission
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {orderedMissions.map((mission, missionIndex) => {
              const missionIsBusy = busyMissionId === mission.id;
              const orderedSteps = sortSteps(mission.steps);

              return (
                <li key={mission.id} className="group/mission min-w-0">
                  <div className="surface-subtle rounded-[28px] px-4 py-4 sm:px-5 sm:py-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="status-badge rounded-full px-2 py-0.5 text-[11px] font-semibold">#{mission.position}</span>
                          <h3 className="text-base font-semibold sm:text-lg">{mission.title}</h3>
                        </div>
                        {mission.description ? (
                          <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                            {mission.description}
                          </p>
                        ) : null}
                      </div>

                      <div className={`flex items-start gap-1 ${MISSION_CARD_ACTIONS_VISIBILITY_CLASS}`}>
                        <button
                          type="button"
                          onClick={() => void handleMoveMission(mission, "up")}
                          disabled={missionIndex === 0 || missionIsBusy}
                          className="button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-50"
                          title="Move up"
                          aria-label="Move mission up"
                        >
                          {missionIsBusy && busyMissionAction === "reorder" ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMoveMission(mission, "down")}
                          disabled={missionIndex === orderedMissions.length - 1 || missionIsBusy}
                          className="button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-50"
                          title="Move down"
                          aria-label="Move mission down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <ActionMenu
                          menuKey={`mission-${mission.id}`}
                          openMenuKey={openMenuKey}
                          onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                        >
                          <ActionMenuItem onClick={() => openMissionEditor(mission)}>
                            <span className="inline-flex items-center gap-2">
                              <PencilLine className="h-4 w-4" aria-hidden="true" />
                              Edit mission
                            </span>
                          </ActionMenuItem>
                          <ActionMenuItem onClick={() => openCreateStepModal(mission)}>
                            <span className="inline-flex items-center gap-2">
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              Create step
                            </span>
                          </ActionMenuItem>
                          <ActionMenuItem
                            tone="danger"
                            onClick={() => {
                              setOpenMenuKey(null);
                              setPendingConfirmation({ kind: "delete_mission", mission });
                            }}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Delete mission
                            </span>
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--foreground-muted)" }}>
                          Steps
                        </h4>
                        <button
                          type="button"
                          onClick={() => openCreateStepModal(mission)}
                          className={`button-ghost inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ${MISSION_CARD_ACTIONS_VISIBILITY_CLASS}`}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          Create step
                        </button>
                      </div>

                      {orderedSteps.length === 0 ? (
                        <p className="mt-2 text-sm" style={{ color: "var(--foreground-muted)" }}>
                          No steps yet.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {orderedSteps.map((step, stepIndex) => {
                            const stepIsBusy = busyStepId === step.id;

                            return (
                              <li key={step.id}>
                                <div
                                  className="group/step rounded-2xl border px-3 py-3"
                                  style={{
                                    borderColor: step.is_next
                                      ? "color-mix(in srgb, var(--accent) 38%, var(--card-border))"
                                      : "color-mix(in srgb, var(--card-border) 72%, transparent)",
                                    backgroundColor: step.is_next
                                      ? "color-mix(in srgb, var(--accent-tint) 42%, var(--background-elevated))"
                                      : "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="status-badge rounded-full px-2 py-0.5 text-[11px] font-semibold">#{step.position}</span>
                                        <p className={`text-sm ${step.is_next ? "font-semibold" : "font-medium"}`}>{step.title}</p>
                                        {step.is_next ? (
                                          <span className="status-badge rounded-full px-2 py-0.5 text-[11px] font-semibold">Next step</span>
                                        ) : null}
                                      </div>
                                      {step.description ? (
                                        <p className="mt-1 text-xs leading-5" style={{ color: "var(--foreground-muted)" }}>
                                          {step.description}
                                        </p>
                                      ) : null}
                                    </div>
                                    <div className={`flex items-center gap-1 ${STEP_CARD_ACTIONS_VISIBILITY_CLASS}`}>
                                      <button
                                        type="button"
                                        onClick={() => void handleToggleNextStep(mission, step)}
                                        disabled={stepIsBusy}
                                        className="button-secondary inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-semibold disabled:opacity-60"
                                        title={step.is_next ? "Clear next step" : "Set as next step"}
                                        aria-label={step.is_next ? "Clear next step" : "Set as next step"}
                                      >
                                        {stepIsBusy && busyStepAction === "next" ? (
                                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                        ) : (
                                          <ActionIcon icon={Target} />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleMoveStep(mission, step, "up")}
                                        disabled={stepIndex === 0 || stepIsBusy}
                                        className="button-secondary inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-semibold disabled:opacity-50"
                                        title="Move step up"
                                        aria-label="Move step up"
                                      >
                                        <ActionIcon icon={ArrowUp} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleMoveStep(mission, step, "down")}
                                        disabled={stepIndex === orderedSteps.length - 1 || stepIsBusy}
                                        className="button-secondary inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-semibold disabled:opacity-50"
                                        title="Move step down"
                                        aria-label="Move step down"
                                      >
                                        <ActionIcon icon={ArrowDown} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openStepEditor(step)}
                                        disabled={stepIsBusy}
                                        className="button-secondary inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-semibold disabled:opacity-60"
                                        title="Edit step"
                                        aria-label="Edit step"
                                      >
                                        <ActionIcon icon={PencilLine} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPendingConfirmation({ kind: "delete_step", step })}
                                        disabled={stepIsBusy}
                                        className="button-danger inline-flex h-8 items-center justify-center rounded-full px-2 text-xs font-semibold disabled:opacity-60"
                                        title="Delete step"
                                        aria-label="Delete step"
                                      >
                                        {stepIsBusy && busyStepAction === "delete" ? (
                                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                        ) : (
                                          <ActionIcon icon={Trash2} />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal
        isOpen={isCreateMissionOpen}
        onClose={closeCreateMissionModal}
        title="Create mission"
        description="Add a mission title and optional short description."
      >
        <form onSubmit={handleCreateMission} className="space-y-4">
          <div>
            <label htmlFor="create-mission-title" className="text-sm font-semibold">
              Title
            </label>
            <input
              id="create-mission-title"
              value={createMissionTitle}
              onChange={(event) => setCreateMissionTitle(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              placeholder="Define the mission"
              required
            />
          </div>

          <div>
            <label htmlFor="create-mission-description" className="text-sm font-semibold">
              Short description
            </label>
            <textarea
              id="create-mission-description"
              value={createMissionDescription}
              onChange={(event) => setCreateMissionDescription(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeCreateMissionModal}
              disabled={isCreateMissionSubmitting}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreateMissionSubmitting}
              className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isCreateMissionSubmitting ? "Creating..." : "Create mission"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={createStepMission !== null}
        onClose={() => {
          if (busyMissionAction === "step_create") return;
          setCreateStepMission(null);
        }}
        title="Create step"
        description={createStepMission ? `Add a step for "${createStepMission.title}".` : "Add a step."}
      >
        <form onSubmit={handleCreateStep} className="space-y-4">
          <div>
            <label htmlFor="create-step-title" className="text-sm font-semibold">
              Step title
            </label>
            <input
              id="create-step-title"
              value={createStepTitle}
              onChange={(event) => setCreateStepTitle(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="create-step-description" className="text-sm font-semibold">
              Short description
            </label>
            <textarea
              id="create-step-description"
              value={createStepDescription}
              onChange={(event) => setCreateStepDescription(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
              placeholder="Optional"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createStepIsNext}
              onChange={(event) => setCreateStepIsNext(event.target.checked)}
            />
            Set as next step
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateStepMission(null)}
              disabled={busyMissionAction === "step_create"}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyMissionAction === "step_create"}
              className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {busyMissionAction === "step_create" ? "Creating..." : "Create step"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={editingMission !== null}
        onClose={closeMissionEditor}
        title="Edit mission"
        description="Update title or short description."
      >
        <form onSubmit={handleUpdateMission} className="space-y-4">
          <div>
            <label htmlFor="edit-mission-title" className="text-sm font-semibold">
              Title
            </label>
            <input
              id="edit-mission-title"
              value={editMissionTitle}
              onChange={(event) => setEditMissionTitle(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="edit-mission-description" className="text-sm font-semibold">
              Short description
            </label>
            <textarea
              id="edit-mission-description"
              value={editMissionDescription}
              onChange={(event) => setEditMissionDescription(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={isMissionEditSubmitting || !editingMission}
              onClick={() => {
                if (!editingMission) return;
                setPendingConfirmation({ kind: "delete_mission", mission: editingMission });
                closeMissionEditor();
              }}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Delete mission
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => closeMissionEditor()}
                disabled={isMissionEditSubmitting}
                className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMissionEditSubmitting}
                className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                {isMissionEditSubmitting ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={editingStep !== null}
        onClose={closeStepEditor}
        title="Edit step"
        description="Keep step details short."
      >
        <form onSubmit={handleUpdateStep} className="space-y-4">
          <div>
            <label htmlFor="edit-step-title" className="text-sm font-semibold">
              Step title
            </label>
            <input
              id="edit-step-title"
              value={editStepTitle}
              onChange={(event) => setEditStepTitle(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="edit-step-description" className="text-sm font-semibold">
              Short description
            </label>
            <textarea
              id="edit-step-description"
              value={editStepDescription}
              onChange={(event) => setEditStepDescription(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editStepIsNext}
              onChange={(event) => setEditStepIsNext(event.target.checked)}
            />
            Set as next step
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={isStepEditSubmitting || !editingStep}
              onClick={() => {
                if (!editingStep) return;
                setPendingConfirmation({ kind: "delete_step", step: editingStep });
                closeStepEditor();
              }}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Delete step
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => closeStepEditor()}
                disabled={isStepEditSubmitting}
                className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isStepEditSubmitting}
                className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                {isStepEditSubmitting ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={pendingConfirmation !== null}
        onClose={() => {
          if (isConfirmationBusy) return;
          setPendingConfirmation(null);
        }}
        title={pendingConfirmation?.kind === "delete_mission" ? "Remove mission?" : "Remove step?"}
        description={
          pendingConfirmation?.kind === "delete_mission"
            ? "This removes the mission and all of its steps."
            : "This removes the selected step from the mission."
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingConfirmation?.kind === "delete_mission"
              ? `Remove "${pendingConfirmation.mission.title}" and all its steps?`
              : pendingConfirmation?.kind === "delete_step"
                ? `Remove step "${pendingConfirmation.step.title}"?`
                : "This action cannot be undone from the current UI."}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingConfirmation(null)}
              disabled={isConfirmationBusy}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!pendingConfirmation) return;
                if (pendingConfirmation.kind === "delete_mission") {
                  void handleDeleteMission(pendingConfirmation.mission);
                  return;
                }
                void handleDeleteStep(pendingConfirmation.step);
              }}
              disabled={isConfirmationBusy}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {pendingConfirmation?.kind === "delete_mission"
                ? busyMissionAction === "delete"
                  ? "Removing..."
                  : "Remove mission"
                : busyStepAction === "delete"
                  ? "Removing..."
                  : "Remove step"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
