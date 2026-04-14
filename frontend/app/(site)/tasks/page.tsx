"use client";

import { isValidJalaaliDate, toGregorian, toJalaali } from "jalaali-js";
import {
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Ellipsis,
  Eraser,
  ListFilter,
  LoaderCircle,
  PencilLine,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, post, put } from "../../utilities/api";
import Modal from "@/components/site/modal";

type AuthState = "checking" | "authenticated" | "guest";
type TaskStatus = "todo" | "done";
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
  is_focused: boolean;
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

type JalaliDateParts = {
  year: string;
  month: string;
  day: string;
};

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string; icon: LucideIcon }> = [
  { value: "all", label: "All tasks", icon: ListFilter },
  { value: "active", label: "Undone tasks", icon: Circle },
  { value: "done", label: "Done tasks", icon: CheckCircle2 },
];

const SESSION_COOKIE_KEY = "planning_session";
const EMPTY_JALALI_DATE: JalaliDateParts = { year: "", month: "", day: "" };

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function formatDueDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return value;

  const jalali = toJalaali(year, month, day);
  return `${jalali.jy}/${String(jalali.jm).padStart(2, "0")}/${String(jalali.jd).padStart(2, "0")}`;
}

function toJalaliDateParts(value: string | null): JalaliDateParts {
  if (!value) return { ...EMPTY_JALALI_DATE };

  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return { ...EMPTY_JALALI_DATE };

  const jalali = toJalaali(year, month, day);
  return {
    year: String(jalali.jy),
    month: String(jalali.jm).padStart(2, "0"),
    day: String(jalali.jd).padStart(2, "0"),
  };
}

function toGregorianDateString(value: JalaliDateParts) {
  const year = Number.parseInt(value.year, 10);
  const month = Number.parseInt(value.month, 10);
  const day = Number.parseInt(value.day, 10);

  if (!year && !month && !day) return null;
  if (!year || !month || !day) {
    throw new Error("Enter a complete Jalali due date.");
  }

  if (!isValidJalaaliDate(year, month, day)) {
    throw new Error("Enter a valid Jalali due date.");
  }

  const gregorian = toGregorian(year, month, day);
  return `${gregorian.gy}-${String(gregorian.gm).padStart(2, "0")}-${String(gregorian.gd).padStart(2, "0")}`;
}

function formatTaskStatus(status: TaskStatus) {
  if (status === "done") return "Done";
  return "To do";
}

function hasSessionCookie() {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${SESSION_COOKIE_KEY}=`));
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
        const Icon = option.icon;

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
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
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
              ["Review sprint goals", "To do", "Today"],
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
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState<JalaliDateParts>({ ...EMPTY_JALALI_DATE });
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editIsFocused, setEditIsFocused] = useState(false);
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

  const filteredTasks = useMemo(() => filterTasks(tasks, statusFilter), [statusFilter, tasks]);
  const focusedTask = useMemo(() => tasks.find((task) => task.is_focused && task.status !== "done") ?? null, [tasks]);
  const visibleFocusedTask = useMemo(() => {
    if (!focusedTask) return null;
    return filterTasks([focusedTask], statusFilter)[0] ?? null;
  }, [focusedTask, statusFilter]);
  const visibleTasks = useMemo(
    () => filteredTasks.filter((task) => task.id !== visibleFocusedTask?.id),
    [filteredTasks, visibleFocusedTask],
  );
  const visibleUndoneTasks = useMemo(() => visibleTasks.filter((task) => task.status !== "done"), [visibleTasks]);
  const visibleDoneTasks = useMemo(() => visibleTasks.filter(isDoneTask), [visibleTasks]);
  const totalTasksCount = tasks.length;
  const completedTasksCount = useMemo(() => tasks.filter(isDoneTask).length, [tasks]);
  const activeTasksCount = totalTasksCount - completedTasksCount;

  function resetCreateForm() {
    setTitle("");
  }

  const openEditModal = useCallback((task: Task) => {
    setOpenMenuKey(null);
    setEditingTask(task);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? "");
    setEditDueDate(toJalaliDateParts(task.due_date));
    setEditStatus(task.status);
    setEditIsFocused(task.is_focused);
  }, []);

  const closeEditModal = useCallback((force = false) => {
    if (!force && isEditSubmitting) return;
    setEditingTask(null);
  }, [isEditSubmitting]);

  const handleEditDueDateChange = useCallback((field: keyof JalaliDateParts, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(0, field === "year" ? 4 : 2);
    setEditDueDate((current) => ({ ...current, [field]: sanitized }));
  }, []);

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
        is_focused: false,
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
        is_focused: nextStatus === "done" ? false : task.is_focused,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedTask = (await response.json()) as Task;
      setTasks((current) => current.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
      setOpenMenuKey(null);
      pushToast("success", nextStatus === "done" ? "Task marked done." : "Task moved back to active.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setBusyTaskId(null);
      setBusyTaskAction(null);
    }
  }

  async function handleToggleFocus(task: Task) {
    if (task.status === "done") {
      pushToast("error", "Done tasks cannot be focused.");
      return;
    }

    setBusyTaskId(task.id);
    setBusyTaskAction("update");

    try {
      const response = await put(`/planning/tasks/${task.id}`, {
        title: task.title,
        notes: task.notes,
        status: task.status,
        due_date: task.due_date,
        is_focused: !task.is_focused,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setOpenMenuKey(null);
      pushToast("success", task.is_focused ? "Focus removed." : "Task set as primary focus.");
      await loadTasks();
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
      const dueDate = toGregorianDateString(editDueDate);
      const response = await put(`/planning/tasks/${editingTask.id}`, {
        title: cleanedTitle,
        notes: editNotes.trim() ? editNotes.trim() : null,
        status: editStatus,
        due_date: dueDate,
        is_focused: editStatus === "done" ? false : editIsFocused,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      await response.json();
      closeEditModal(true);
      setOpenMenuKey(null);
      pushToast("success", editIsFocused ? "Focus task updated." : "Task updated.");
      await loadTasks();
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
      setOpenMenuKey(null);
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

  const hasVisibleTasks = visibleFocusedTask !== null || visibleUndoneTasks.length > 0 || visibleDoneTasks.length > 0;
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

      <section className="px-1 pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-4xl flex-1">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">My tasks</h2>
            <p className="mt-1 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              A lighter workspace for triaging what still needs attention and what is already done.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
              <MetaItem icon={<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />}>{totalTasksCount} total</MetaItem>
              <MetaItem icon={<Circle className="h-3.5 w-3.5" aria-hidden="true" />}>{activeTasksCount} undone</MetaItem>
              <MetaItem icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>{completedTasksCount} done</MetaItem>
              <MetaItem icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}>
                {focusedTask ? "1 primary focus" : "No focus selected"}
              </MetaItem>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            <StatusFilterControl value={statusFilter} onChange={setStatusFilter} />
            <button
              type="button"
              onClick={() => setPendingConfirmation({ kind: "clear_completed" })}
              disabled={isLoading || isClearingCompleted || completedTasksCount === 0}
              className="button-ghost inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium disabled:opacity-60"
            >
              {isClearingCompleted ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Eraser className="h-4 w-4" aria-hidden="true" />
              )}
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
            <div className="space-y-4">
              {visibleFocusedTask ? (
                <article className="focus-task-card p-6 sm:p-7" aria-live="polite">
                  <div className="focus-task-content flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <span className="focus-task-badge inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          Primary focus
                        </span>
                        <h3
                          className={`mt-4 text-2xl font-semibold tracking-tight sm:text-3xl ${
                            visibleFocusedTask.status === "done" ? "line-through opacity-75" : ""
                          }`}
                        >
                          {visibleFocusedTask.title}
                        </h3>
                        <div className="mt-3 max-w-3xl text-sm leading-7 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
                          {visibleFocusedTask.notes?.trim() ? (
                            <div className="[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5">
                              <ReactMarkdown>{visibleFocusedTask.notes.trim()}</ReactMarkdown>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
                          <MetaItem icon={visibleFocusedTask.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}>
                            {formatTaskStatus(visibleFocusedTask.status)}
                          </MetaItem>
                          {visibleFocusedTask.due_date ? (
                            <MetaItem icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}>
                              {formatDueDate(visibleFocusedTask.due_date)}
                            </MetaItem>
                          ) : null}
                          <MetaItem icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}>Focused</MetaItem>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleDone(visibleFocusedTask);
                          }}
                          disabled={busyTaskId === visibleFocusedTask.id}
                          className="button-secondary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold disabled:opacity-60"
                        >
                          {busyTaskId === visibleFocusedTask.id && busyTaskAction === "toggle" ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : visibleFocusedTask.status === "done" ? (
                            <Circle className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {visibleFocusedTask.status === "done" ? "Undo" : "Done"}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleFocus(visibleFocusedTask);
                          }}
                          disabled={busyTaskId === visibleFocusedTask.id}
                          className="button-secondary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold disabled:opacity-60"
                        >
                          {busyTaskId === visibleFocusedTask.id && busyTaskAction === "update" ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Target className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          Unfocus
                        </button>
                        <ActionMenu
                          menuKey={`task-${visibleFocusedTask.id}`}
                          openMenuKey={openMenuKey}
                          onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                        >
                          <ActionMenuItem onClick={() => openEditModal(visibleFocusedTask)}>
                            <span className="inline-flex items-center gap-2">
                              <PencilLine className="h-4 w-4" aria-hidden="true" />
                              Edit task
                            </span>
                          </ActionMenuItem>
                          <ActionMenuItem
                            tone="danger"
                            onClick={() => {
                              setOpenMenuKey(null);
                              setPendingConfirmation({ kind: "delete", task: visibleFocusedTask });
                            }}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Delete task
                            </span>
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>
                    </div>
                  </div>
                </article>
              ) : null}

              {visibleUndoneTasks.length > 0 ? (
                <section className="space-y-3" aria-live="polite">
                  <div className="flex flex-col gap-2 px-1 py-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">{visibleFocusedTask ? "Supporting tasks" : "Active tasks"}</h3>
                      <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                        {visibleUndoneTasks.length} shown
                      </span>
                    </div>
                    <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                      {visibleFocusedTask
                        ? "Keep moving items here to support your primary focus."
                        : "Open any task to edit details or make it the primary focus."}
                    </p>
                  </div>

                  <ul className="grid gap-3 xl:grid-cols-2">
                    {visibleUndoneTasks.map((task) => {
                      const isBusy = busyTaskId === task.id;
                      const isTogglingTask = isBusy && busyTaskAction === "toggle";
                      const isUpdatingTask = isBusy && busyTaskAction === "update";
                      const dueLabel = formatDueDate(task.due_date);

                      return (
                        <li key={task.id} className="group min-w-0">
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
                            className="surface-subtle flex h-full min-w-0 flex-col gap-4 rounded-[28px] px-4 py-4 text-left sm:px-5 sm:py-5"
                            style={{
                              backgroundColor: isBusy
                                ? "color-mix(in srgb, var(--accent-tint) 26%, var(--background-elevated))"
                                : undefined,
                            }}
                            aria-label={`Open details for ${task.title}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold sm:text-lg">{task.title}</h3>
                              </div>

                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleDone(task);
                                  }}
                                  disabled={isBusy}
                                  className="button-secondary inline-flex h-9 items-center justify-center rounded-full px-2.5 text-xs font-semibold disabled:opacity-60"
                                  title="Mark as done"
                                  aria-label="Mark as done"
                                >
                                  {isTogglingTask ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleFocus(task);
                                  }}
                                  disabled={isBusy}
                                  className="button-secondary inline-flex h-9 items-center justify-center rounded-full px-2.5 text-xs font-semibold disabled:opacity-60"
                                  title={task.is_focused ? "Remove focus" : "Set as focus"}
                                  aria-label={task.is_focused ? "Remove focus" : "Set as focus"}
                                >
                                  {isUpdatingTask ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Target className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                </button>
                                <ActionMenu
                                  menuKey={`task-${task.id}`}
                                  openMenuKey={openMenuKey}
                                  onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                                >
                                  <ActionMenuItem onClick={() => openEditModal(task)}>
                                    <span className="inline-flex items-center gap-2">
                                      <PencilLine className="h-4 w-4" aria-hidden="true" />
                                      Edit task
                                    </span>
                                  </ActionMenuItem>
                                  <ActionMenuItem
                                    tone="danger"
                                    onClick={() => {
                                      setOpenMenuKey(null);
                                      setPendingConfirmation({ kind: "delete", task });
                                    }}
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                      Delete task
                                    </span>
                                  </ActionMenuItem>
                                </ActionMenu>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
                              <MetaItem icon={<Circle className="h-3.5 w-3.5" aria-hidden="true" />}>
                                {formatTaskStatus(task.status)}
                              </MetaItem>
                              {dueLabel ? (
                                <MetaItem icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}>
                                  {dueLabel}
                                </MetaItem>
                              ) : null}
                              {task.is_focused ? (
                                <MetaItem icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}>Focused</MetaItem>
                              ) : null}
                              {isTogglingTask ? (
                                <MetaItem icon={<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}>
                                  Updating status
                                </MetaItem>
                              ) : null}
                              {isUpdatingTask ? (
                                <MetaItem icon={<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}>
                                  Updating focus
                                </MetaItem>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {visibleDoneTasks.length > 0 ? (
                <section className="space-y-3" aria-live="polite">
                  <div className="flex flex-col gap-2 px-1 py-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">Done tasks</h3>
                      <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                        {visibleDoneTasks.length} shown
                      </span>
                    </div>
                    <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                      Completed tasks are grouped here until you clear them.
                    </p>
                  </div>

                  <ul className="grid gap-3 xl:grid-cols-2">
                    {visibleDoneTasks.map((task) => {
                      const isBusy = busyTaskId === task.id;
                      const isTogglingTask = isBusy && busyTaskAction === "toggle";
                      const dueLabel = formatDueDate(task.due_date);

                      return (
                        <li key={task.id} className="group min-w-0">
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
                            className="surface-subtle flex h-full min-w-0 flex-col gap-4 rounded-[28px] px-4 py-4 text-left opacity-90 sm:px-5 sm:py-5"
                            style={{
                              backgroundColor: isBusy
                                ? "color-mix(in srgb, var(--accent-tint) 26%, var(--background-elevated))"
                                : undefined,
                            }}
                            aria-label={`Open details for ${task.title}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold line-through opacity-70 sm:text-lg">{task.title}</h3>
                              </div>

                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleDone(task);
                                  }}
                                  disabled={isBusy}
                                  className="button-secondary inline-flex h-9 items-center justify-center rounded-full px-2.5 text-xs font-semibold disabled:opacity-60"
                                  title="Move back to active"
                                  aria-label="Move back to active"
                                >
                                  {isTogglingTask ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Circle className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                </button>
                                <ActionMenu
                                  menuKey={`task-${task.id}`}
                                  openMenuKey={openMenuKey}
                                  onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                                >
                                  <ActionMenuItem onClick={() => openEditModal(task)}>
                                    <span className="inline-flex items-center gap-2">
                                      <PencilLine className="h-4 w-4" aria-hidden="true" />
                                      Edit task
                                    </span>
                                  </ActionMenuItem>
                                  <ActionMenuItem
                                    tone="danger"
                                    onClick={() => {
                                      setOpenMenuKey(null);
                                      setPendingConfirmation({ kind: "delete", task });
                                    }}
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                      Delete task
                                    </span>
                                  </ActionMenuItem>
                                </ActionMenu>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
                              <MetaItem icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Done</MetaItem>
                              {dueLabel ? (
                                <MetaItem icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}>
                                  {dueLabel}
                                </MetaItem>
                              ) : null}
                              {isTogglingTask ? (
                                <MetaItem icon={<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}>
                                  Updating status
                                </MetaItem>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="sticky bottom-0 z-10 mt-6 px-1 pb-3 pt-8">
        <form onSubmit={handleCreateTask} autoComplete="off" className="task-composer mx-auto max-w-4xl px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ color: "var(--foreground-muted)" }}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>

            <input
              id="new-task-title"
              name="new-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a task..."
              className="task-composer-input min-h-12 flex-1 bg-transparent text-sm"
              aria-label="Add a task"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />

            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="task-composer-send inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0 disabled:opacity-60"
              aria-label={isSubmitting ? "Adding task" : "Add task"}
              title={isSubmitting ? "Adding..." : "Add task"}
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
      </section>

      <Modal
        isOpen={editingTask !== null}
        onClose={closeEditModal}
        title="Edit task"
        description="Update the title, markdown notes, Jalali due date, or completion state."
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
              placeholder="Optional context (Markdown supported)"
              className="field mt-2 min-h-28 rounded-2xl px-4 py-3 text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-task-due-year" className="text-sm font-semibold">
                Due date (Jalali)
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input
                  id="edit-task-due-year"
                  inputMode="numeric"
                  placeholder="1403"
                  value={editDueDate.year}
                  onChange={(event) => handleEditDueDateChange("year", event.target.value)}
                  className="field rounded-2xl px-4 py-3 text-sm"
                  aria-label="Jalali due year"
                />
                <input
                  id="edit-task-due-month"
                  inputMode="numeric"
                  placeholder="01"
                  value={editDueDate.month}
                  onChange={(event) => handleEditDueDateChange("month", event.target.value)}
                  className="field rounded-2xl px-4 py-3 text-sm"
                  aria-label="Jalali due month"
                />
                <input
                  id="edit-task-due-day"
                  inputMode="numeric"
                  placeholder="01"
                  value={editDueDate.day}
                  onChange={(event) => handleEditDueDateChange("day", event.target.value)}
                  className="field rounded-2xl px-4 py-3 text-sm"
                  aria-label="Jalali due day"
                />
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--foreground-muted)" }}>
                Enter year, month, then day. It is stored as Gregorian and shown as Jalali.
              </p>
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
                onClick={() => closeEditModal()}
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
