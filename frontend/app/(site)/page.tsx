"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, post, put } from "../utilities/api";
import Modal from "@/components/site/modal";

type AuthState = "checking" | "authenticated" | "guest";
type TaskStatus = "todo" | "in_progress" | "done";
type StatusFilter = "all" | "active" | "done";
type BusyTaskAction = "toggle" | "delete" | "update";

type Task = {
  id: number;
  user_id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PendingConfirmation =
  | { kind: "delete"; task: Task }
  | { kind: "clear_completed" }
  | null;

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "Undone tasks" },
  { value: "done", label: "Done tasks" },
];

const SESSION_COOKIE_KEY = "planning_session";

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function formatDueDate(value: string | null) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function summarizeNotes(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 128) return trimmed;
  return `${trimmed.slice(0, 125)}...`;
}

function hasSessionCookie() {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${SESSION_COOKIE_KEY}=`));
}

function statusPillStyle(status: TaskStatus) {
  if (status === "done") {
    return {
      backgroundColor: "color-mix(in srgb, var(--success-tint) 86%, transparent)",
      color: "var(--success)",
    };
  }

  if (status === "in_progress") {
    return {
      backgroundColor: "color-mix(in srgb, var(--accent-tint) 84%, transparent)",
      color: "var(--accent)",
    };
  }

  return {
    backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)",
    color: "var(--foreground-muted)",
  };
}

function isDoneTask(task: Task) {
  return task.status === "done";
}

function filterTasks(tasks: Task[], filter: StatusFilter) {
  if (filter === "done") {
    return tasks.filter(isDoneTask);
  }

  if (filter === "active") {
    return tasks.filter((task) => !isDoneTask(task));
  }

  return tasks;
}

function FilterIcon({ filter }: { filter: StatusFilter }) {
  if (filter === "active") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none" style={{ stroke: "currentColor" }} aria-hidden="true">
        <circle cx="12" cy="12" r="7" strokeWidth="1.8" />
      </svg>
    );
  }

  if (filter === "done") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none" style={{ stroke: "currentColor" }} aria-hidden="true">
        <circle cx="12" cy="12" r="7" strokeWidth="1.8" />
        <path d="m8.8 12.2 2.2 2.2 4.3-4.6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none" style={{ stroke: "currentColor" }} aria-hidden="true">
      <path d="M8 7h9" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 12h9" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 17h9" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5.25" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.25" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.25" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StatusFilterControl({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (nextValue: StatusFilter) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{
        backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)",
        border: "1px solid color-mix(in srgb, var(--card-border) 62%, transparent)",
      }}
      role="group"
      aria-label="Filter tasks"
    >
      {FILTER_OPTIONS.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={
              active
                ? {
                    backgroundColor: "var(--accent-tint)",
                    color: "var(--accent)",
                    boxShadow: "var(--shadow-2)",
                  }
                : { color: "var(--foreground-muted)" }
            }
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
          >
            <FilterIcon filter={option.value} />
          </button>
        );
      })}
    </div>
  );
}

function GuestHome() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <main className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
          <span
            className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            Material 3 preview
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            A calmer way to capture work and keep the next step obvious.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Planning keeps your tasks, due dates, and status changes in one focused workspace. The refreshed UI
            borrows Material Design 3 ideas: tonal surfaces, clear hierarchy, and calm controls.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="button-primary rounded-full px-5 py-3 text-sm font-semibold">
              Sign in to your workspace
            </Link>
            <Link href="/login" className="button-secondary rounded-full px-5 py-3 text-sm font-semibold">
              Create an account
            </Link>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ["Focused dashboard", "See open work, progress, and completed items at a glance."],
              ["Safer actions", "Clear confirmations and explicit save steps reduce accidental changes."],
              ["Minimal flow", "Create tasks fast, then reveal extra details only when needed."],
            ].map(([titleText, description]) => (
              <article key={titleText} className="surface-subtle rounded-3xl p-4">
                <h2 className="text-sm font-semibold">{titleText}</h2>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                  {description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <aside className="surface-card rounded-[28px] p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Workspace preview</p>
              <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                What the dashboard looks like after sign-in.
              </p>
            </div>
            <span className="status-badge rounded-full px-3 py-1 text-xs font-medium">Preview</span>
          </div>

          <div className="mt-6 space-y-3">
            {[
              ["Review sprint goals", "In progress", "Today"],
              ["Send weekly status update", "To do", "Tomorrow"],
              ["Close resolved support tickets", "Done", "Completed"],
            ].map(([taskTitle, status, due]) => (
              <article key={taskTitle} className="surface-subtle rounded-3xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{taskTitle}</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                      Due {due}
                    </p>
                  </div>
                  <span className="status-badge rounded-full px-3 py-1 text-xs font-medium">{status}</span>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-44 rounded-xl" />
      <div className="skeleton h-28 rounded-[28px]" />
      <div className="skeleton h-28 rounded-[28px]" />
      <div className="skeleton h-28 rounded-[28px]" />
    </div>
  );
}

export default function HomePage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearingCompleted, setIsClearingCompleted] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [busyTaskAction, setBusyTaskAction] = useState<BusyTaskAction | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
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

  const loadTasks = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await get("/planning/tasks");

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as Task[];
      setTasks(data);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load tasks");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasSessionCookie() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadTasks();
  }, [authState, loadTasks]);

  const visibleTasks = useMemo(() => filterTasks(tasks, statusFilter), [statusFilter, tasks]);
  const totalTasksCount = tasks.length;
  const completedTasksCount = useMemo(() => tasks.filter(isDoneTask).length, [tasks]);
  const activeTasksCount = totalTasksCount - completedTasksCount;

  function resetCreateForm() {
    setTitle("");
  }

  function openEditModal(task: Task) {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? "");
    setEditDueDate(task.due_date ? task.due_date.slice(0, 10) : "");
    setEditStatus(task.status);
  }

  function closeEditModal() {
    if (isEditSubmitting) return;
    setEditingTask(null);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedTitle = title.trim();
    if (!cleanedTitle) return;

    setIsSubmitting(true);

    try {
      const response = await post("/planning/tasks", {
        title: cleanedTitle,
        notes: null,
        status: "todo",
        due_date: null,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      resetCreateForm();
      pushToast("success", "Task created.");
      await loadTasks();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleDone(task: Task) {
    const nextStatus: TaskStatus = task.status === "done" ? "todo" : "done";
    setBusyTaskId(task.id);
    setBusyTaskAction("toggle");

    try {
      const response = await put(`/planning/tasks/${task.id}`, {
        title: task.title,
        notes: task.notes,
        status: nextStatus,
        due_date: task.due_date,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedTask = (await response.json()) as Task;
      setTasks((current) => current.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
      pushToast("success", nextStatus === "done" ? "Task marked done." : "Task moved back to active.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setBusyTaskId(null);
      setBusyTaskAction(null);
    }
  }

  async function handleUpdateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask) return;

    const cleanedTitle = editTitle.trim();
    if (!cleanedTitle) return;

    setIsEditSubmitting(true);

    try {
      const response = await put(`/planning/tasks/${editingTask.id}`, {
        title: cleanedTitle,
        notes: editNotes.trim() ? editNotes.trim() : null,
        status: editStatus,
        due_date: editDueDate || null,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedTask = (await response.json()) as Task;
      setTasks((current) => current.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
      setEditingTask(updatedTask);
      pushToast("success", "Task updated.");
      closeEditModal();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setIsEditSubmitting(false);
    }
  }

  async function handleDeleteTask(task: Task) {
    setBusyTaskId(task.id);
    setBusyTaskAction("delete");

    try {
      const response = await del(`/planning/tasks/${task.id}`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setTasks((current) => current.filter((item) => item.id !== task.id));
      setPendingConfirmation(null);
      setEditingTask(null);
      pushToast("success", "Task removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove task");
    } finally {
      setBusyTaskId(null);
      setBusyTaskAction(null);
    }
  }

  async function handleClearCompleted() {
    setIsClearingCompleted(true);

    try {
      const response = await del("/planning/tasks/completed");

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPendingConfirmation(null);
      pushToast("success", "Completed tasks cleared.");
      await loadTasks();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to clear completed tasks");
    } finally {
      setIsClearingCompleted(false);
    }
  }

  if (authState === "checking") {
    return <DashboardLoadingState />;
  }

  if (authState === "guest") {
    return <GuestHome />;
  }

  const hasVisibleTasks = visibleTasks.length > 0;
  const isConfirmationBusy = busyTaskAction === "delete" || isClearingCompleted;

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

      <section className="px-1 pb-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">My tasks</h2>
            <p className="mt-2 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              A lighter workspace for triaging what still needs attention and what is already done.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                  color: "var(--foreground-muted)",
                }}
              >
                {totalTasksCount} total
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--accent-tint) 60%, transparent)",
                  color: "var(--accent)",
                }}
              >
                {activeTasksCount} undone
              </span>
              <span className="rounded-full px-3 py-1.5 text-xs font-medium" style={statusPillStyle("done")}>
                {completedTasksCount} done
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--foreground-muted)" }}>
                View
              </p>
              <StatusFilterControl value={statusFilter} onChange={setStatusFilter} />
            </div>
            <button
              type="button"
              onClick={() => setPendingConfirmation({ kind: "clear_completed" })}
              disabled={isLoading || isClearingCompleted || completedTasksCount === 0}
              className="button-ghost rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {isClearingCompleted ? "Clearing..." : "Clear done"}
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 flex-1">
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3" aria-live="polite">
              <div className="skeleton h-28 rounded-[32px]" />
              <div className="skeleton h-28 rounded-[32px]" />
              <div className="skeleton h-28 rounded-[32px]" />
            </div>
          ) : !hasVisibleTasks ? (
            <div
              className="surface-card px-5 py-10 sm:px-6"
              style={{ borderRadius: "32px" }}
            >
              <h3 className="text-lg font-semibold">
                {statusFilter === "all" ? "Nothing here yet" : `No ${statusFilter === "active" ? "undone" : "done"} tasks`}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                {statusFilter === "all"
                  ? "Create your first task to start building a focused list for the day."
                  : "Switch views or return to all tasks to see the rest of your workspace."}
              </p>
              {statusFilter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className="button-ghost mt-5 rounded-full px-5 py-3 text-sm font-semibold"
                >
                  Show all tasks
                </button>
              ) : null}
            </div>
          ) : (
            <ul
              className="surface-card overflow-hidden"
              style={{ borderRadius: "32px" }}
              aria-live="polite"
            >
              {visibleTasks.map((task) => {
                const isBusy = busyTaskId === task.id;
                const isDeletingTask = isBusy && busyTaskAction === "delete";
                const isTogglingTask = isBusy && busyTaskAction === "toggle";
                const dueLabel = formatDueDate(task.due_date);
                const notePreview = summarizeNotes(task.notes);

                return (
                  <li
                    key={task.id}
                    className="group border-b last:border-b-0"
                    style={{
                      borderColor: "color-mix(in srgb, var(--card-border) 42%, transparent)",
                    }}
                  >
                    <div
                      className="flex gap-3 px-4 py-4 transition-colors sm:px-6 sm:py-5"
                      style={{
                        backgroundColor: isBusy
                          ? "color-mix(in srgb, var(--accent-tint) 18%, var(--background-elevated))"
                          : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void handleToggleDone(task)}
                        disabled={isBusy}
                        aria-label={task.status === "done" ? `Mark ${task.title} as to do` : `Mark ${task.title} as done`}
                        className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
                        style={
                          task.status === "done"
                            ? {
                                backgroundColor: "var(--accent)",
                                borderColor: "var(--accent)",
                                color: "#ffffff",
                              }
                            : {
                                backgroundColor: "var(--background-elevated)",
                                borderColor: "color-mix(in srgb, var(--card-border) 80%, transparent)",
                                color: "var(--foreground-muted)",
                              }
                        }
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" style={{ stroke: "currentColor" }} aria-hidden="true">
                          <path d="m6.5 12.5 3.2 3.2 7.8-7.8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>

                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openEditModal(task)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openEditModal(task);
                          }
                        }}
                        className="interactive-card min-w-0 flex-1 rounded-[24px] px-2 py-1 text-left sm:px-3"
                        aria-label={`Open details for ${task.title}`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className={`text-base font-semibold sm:text-lg ${task.status === "done" ? "line-through opacity-70" : ""}`}>
                                {task.title}
                              </h3>
                              <span className="rounded-full px-3 py-1 text-xs font-medium" style={statusPillStyle(task.status)}>
                                {STATUS_LABELS[task.status]}
                              </span>
                            </div>

                            {notePreview ? (
                              <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                                {notePreview}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {dueLabel ? (
                                <span
                                  className="rounded-full px-3 py-1 text-xs font-medium"
                                  style={{
                                    backgroundColor: "color-mix(in srgb, var(--background-subtle) 72%, transparent)",
                                    color: "var(--foreground-muted)",
                                  }}
                                >
                                  Due {dueLabel}
                                </span>
                              ) : null}
                              {task.notes ? (
                                <span
                                  className="rounded-full px-3 py-1 text-xs font-medium"
                                  style={{
                                    backgroundColor: "color-mix(in srgb, var(--background-elevated) 92%, transparent)",
                                    color: "var(--foreground-muted)",
                                  }}
                                >
                                  Notes attached
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-start">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingConfirmation({ kind: "delete", task });
                              }}
                              disabled={isBusy || isClearingCompleted}
                              className="button-danger flex h-10 w-10 items-center justify-center rounded-full p-0"
                              aria-label={`Remove ${task.title}`}
                              title="Remove task"
                            >
                              {isDeletingTask ? (
                                <span className="text-[10px] font-semibold">...</span>
                              ) : (
                                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none" style={{ stroke: "currentColor" }} aria-hidden="true">
                                  <path d="M9.5 9.5v6" strokeWidth="1.8" strokeLinecap="round" />
                                  <path d="M14.5 9.5v6" strokeWidth="1.8" strokeLinecap="round" />
                                  <path d="M5.5 7.5h13" strokeWidth="1.8" strokeLinecap="round" />
                                  <path d="M8.5 7.5V6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.5" strokeWidth="1.8" strokeLinecap="round" />
                                  <path d="m7.2 7.5.7 10a1.5 1.5 0 0 0 1.5 1.4h5.2a1.5 1.5 0 0 0 1.5-1.4l.7-10" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>

                        <p className="mt-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
                          {isTogglingTask
                            ? "Updating status..."
                            : task.status === "done"
                              ? "Completed tasks stay visible until you clear them."
                              : "Open details for notes, due date, or status changes."}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="sticky bottom-0 mt-5 pb-2">
        <form
          onSubmit={handleCreateTask}
          className="surface-card mx-auto flex max-w-4xl items-center gap-3 rounded-[28px] px-3 py-3 sm:px-4"
          style={{
            backgroundColor: "color-mix(in srgb, var(--card) 92%, transparent)",
            backdropFilter: "blur(18px)",
          }}
        >
          <input
            id="new-task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task..."
            className="field min-h-12 rounded-full border-transparent bg-transparent px-4 py-3 text-sm shadow-none focus:border-transparent focus:shadow-none"
            aria-label="Add a task"
            required
          />
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="button-primary rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {isSubmitting ? "Adding..." : "Add"}
          </button>
        </form>
      </section>

      <Modal
        isOpen={editingTask !== null}
        onClose={closeEditModal}
        title="Edit task"
        description="Adjust the task only when you need more detail. The list stays clean, the editor carries the rest."
      >
        <form onSubmit={handleUpdateTask} className="space-y-4">
          <div>
            <label htmlFor="edit-task-title" className="text-sm font-semibold">
              Title
            </label>
            <input
              id="edit-task-title"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="edit-task-notes" className="text-sm font-semibold">
              Notes
            </label>
            <textarea
              id="edit-task-notes"
              value={editNotes}
              onChange={(event) => setEditNotes(event.target.value)}
              placeholder="Optional context"
              className="field mt-2 min-h-28 rounded-2xl px-4 py-3 text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-task-due-date" className="text-sm font-semibold">
                Due date
              </label>
              <input
                id="edit-task-due-date"
                type="date"
                value={editDueDate}
                onChange={(event) => setEditDueDate(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="edit-task-status" className="text-sm font-semibold">
                Status
              </label>
              <select
                id="edit-task-status"
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as TaskStatus)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              >
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={isEditSubmitting || !editingTask}
              onClick={() => {
                if (!editingTask) return;
                setPendingConfirmation({ kind: "delete", task: editingTask });
                closeEditModal();
              }}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Delete task
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isEditSubmitting}
                className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isEditSubmitting}
                className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                {isEditSubmitting ? "Saving..." : "Save changes"}
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
        title={pendingConfirmation?.kind === "delete" ? "Remove task?" : "Clear completed tasks?"}
        description={
          pendingConfirmation?.kind === "delete"
            ? "This removes the task from your workspace."
            : "This removes every completed task from the current workspace."
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingConfirmation?.kind === "delete"
              ? `Remove "${pendingConfirmation.task.title}"?`
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
              onClick={() =>
                pendingConfirmation?.kind === "delete"
                  ? void handleDeleteTask(pendingConfirmation.task)
                  : void handleClearCompleted()
              }
              disabled={isConfirmationBusy}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {pendingConfirmation?.kind === "delete"
                ? busyTaskAction === "delete"
                  ? "Removing..."
                  : "Remove task"
                : isClearingCompleted
                  ? "Clearing..."
                  : "Clear completed"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
