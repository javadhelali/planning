"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { del, get, post, put } from "../utilities/api";
import Modal from "@/components/site/modal";
import ThemeToggle from "../../components/site/theme-toggle";

type TaskStatus = "todo" | "in_progress" | "done";
type StatusFilter = "all" | TaskStatus;

type Task = {
  id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

async function readErrorMessage(res: Response) {
  const payload = await res.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${res.status})`;
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const response = await get(`/planning/tasks${query}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const data = (await response.json()) as Task[];
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const openTasksCount = useMemo(
    () => tasks.filter((task) => task.status !== "done").length,
    [tasks],
  );
  const completedTasksCount = useMemo(
    () => tasks.filter((task) => task.status === "done").length,
    [tasks],
  );

  function resetCreateForm() {
    setTitle("");
    setNotes("");
    setDueDate("");
    setCreateStatus("todo");
    setShowAdvancedFields(false);
  }

  function openCreateModal() {
    setError(null);
    setSuccessMessage(null);
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (isSubmitting) return;
    setIsCreateModalOpen(false);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedTitle = title.trim();
    if (!cleanedTitle) return;

    setIsSubmitting(true);
    setSuccessMessage(null);
    setError(null);
    try {
      const response = await post("/planning/tasks", {
        title: cleanedTitle,
        notes: notes.trim() ? notes.trim() : null,
        status: createStatus,
        due_date: dueDate || null,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      resetCreateForm();
      setIsCreateModalOpen(false);
      setSuccessMessage("Task created.");
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateStatus(task: Task, nextStatus: TaskStatus) {
    setBusyTaskId(task.id);
    setSuccessMessage(null);
    setError(null);
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
      setTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
      setSuccessMessage("Task updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleDeleteTask(taskId: number) {
    setBusyTaskId(taskId);
    setSuccessMessage(null);
    setError(null);
    try {
      const response = await del(`/planning/tasks/${taskId}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      setSuccessMessage("Task removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleClearCompleted() {
    setSuccessMessage(null);
    setError(null);
    try {
      const response = await del("/planning/tasks/completed");
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      await loadTasks();
      setSuccessMessage("Completed tasks cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear completed tasks");
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-4xl px-4 py-8 font-sans sm:px-6 sm:py-10">
      <main
        className="w-full rounded-3xl border p-5 shadow-sm sm:p-8 md:p-10"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--card-border)",
        }}
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">My Tasks</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              Keep your priorities clear and your next actions visible.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreateModal}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--accent)" }}
            >
              New task
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <section
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
          >
            <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
              Open tasks
            </p>
            <p className="mt-1 text-2xl font-semibold">{openTasksCount}</p>
          </section>
          <section
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
          >
            <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
              Completed
            </p>
            <p className="mt-1 text-2xl font-semibold">{completedTasksCount}</p>
          </section>
        </div>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <label htmlFor="status-filter" className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
              Filter
            </label>
            <div className="mt-1">
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-xl border px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
              >
                <option value="all">All statuses</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearCompleted}
              disabled={isLoading || busyTaskId !== null || completedTasksCount === 0}
              className="rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--card-border)" }}
            >
              Clear completed
            </button>
          </div>
        </div>

        {successMessage ? (
          <p
            className="mb-3 rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: "#16a34a", color: "#16a34a" }}
            aria-live="polite"
          >
            {successMessage}
          </p>
        ) : null}

        {error ? (
          <p
            className="mb-3 rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: "#ef4444", color: "#ef4444" }}
            aria-live="polite"
          >
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="rounded-xl border px-3 py-4 text-sm" style={{ color: "var(--muted-foreground)", borderColor: "var(--card-border)" }}>
            Loading tasks...
          </p>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border px-3 py-4 text-sm" style={{ color: "var(--muted-foreground)", borderColor: "var(--card-border)" }}>
            No tasks found for this filter.
          </p>
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="rounded-2xl border px-4 py-3"
                style={{ borderColor: "var(--card-border)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-medium ${task.status === "done" ? "line-through opacity-70" : ""}`}>
                      {task.title}
                    </p>
                    {task.notes ? (
                      <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {task.notes}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      Due: {formatDueDate(task.due_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={task.status}
                      disabled={busyTaskId === task.id}
                      onChange={(event) => handleUpdateStatus(task, event.target.value as TaskStatus)}
                      className="rounded-lg border px-2 py-1 text-xs outline-none"
                      style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
                    >
                      <option value="todo">Todo</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                    <button
                      type="button"
                      disabled={busyTaskId === task.id}
                      onClick={() => handleDeleteTask(task.id)}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--card-border)" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{STATUS_LABELS[task.status]}</p>
              </li>
            ))}
          </ul>
        )}

        <Modal
          isOpen={isCreateModalOpen}
          onClose={closeCreateModal}
          title="Create task"
          description="Start with a title, then add optional details only if needed."
        >
          <form onSubmit={handleCreateTask} className="space-y-4">
            <div>
              <label htmlFor="new-task-title" className="text-sm font-medium">
                Title
              </label>
              <input
                id="new-task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to be done?"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
                required
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedFields((prev) => !prev)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--card-border)" }}
            >
              {showAdvancedFields ? "Hide details" : "Add details"}
            </button>

            {showAdvancedFields ? (
              <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--card-border)" }}>
                <div>
                  <label htmlFor="new-task-notes" className="text-sm font-medium">
                    Notes
                  </label>
                  <textarea
                    id="new-task-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional context"
                    className="mt-1 min-h-20 w-full rounded-xl border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="new-task-due-date" className="text-sm font-medium">
                      Due date
                    </label>
                    <input
                      id="new-task-due-date"
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
                      style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-task-status" className="text-sm font-medium">
                      Initial status
                    </label>
                    <select
                      id="new-task-status"
                      value={createStatus}
                      onChange={(event) => setCreateStatus(event.target.value as TaskStatus)}
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
                      style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}
                    >
                      <option value="todo">Todo</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--card-border)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl px-3 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--accent)" }}
              >
                {isSubmitting ? "Creating..." : "Create task"}
              </button>
            </div>
          </form>
        </Modal>
      </main>
    </div>
  );
}
