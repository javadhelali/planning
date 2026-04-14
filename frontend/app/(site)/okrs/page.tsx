"use client";

import {
  Archive,
  LoaderCircle,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, patch, post, put } from "../../utilities/api";
import Modal from "@/components/site/modal";

type AuthState = "checking" | "authenticated" | "guest";
type OkrView = "active" | "archived";
type KeyResultHealth = "ahead" | "on_track" | "off_track" | "critical";

type KeyResult = {
  id: number;
  title: string;
  start_value: number;
  current_value: number;
  target_value: number;
  step_value: number;
  unit: string | null;
  created_at: string;
  updated_at: string;
};

type Okr = {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  key_results: KeyResult[];
};

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

type ObjectiveEditorState =
  | { mode: "create" }
  | { mode: "edit"; objective: Okr }
  | null;

type KeyResultEditorState =
  | { objective: Okr; keyResult: KeyResult | null }
  | null;

type PendingConfirmation =
  | { kind: "objective"; objective: Okr }
  | { kind: "key_result"; objectiveTitle: string; keyResult: KeyResult }
  | null;

const SESSION_COOKIE_KEY = "planning_session";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

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

function parseDateString(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function localTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffInDays(start: string, end: string) {
  return Math.round((parseDateString(end).getTime() - parseDateString(start).getTime()) / DAY_IN_MS);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function formatMetricValue(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateString(value));
}

function formatDateRange(startDate: string, endDate: string) {
  return `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;
}

function sortOkrs(items: Okr[]) {
  return [...items].sort((left, right) => {
    if (left.is_archived !== right.is_archived) {
      return left.is_archived ? 1 : -1;
    }

    if (!left.is_archived && !right.is_archived) {
      const endComparison = left.end_date.localeCompare(right.end_date);
      if (endComparison !== 0) return endComparison;
      return right.created_at.localeCompare(left.created_at);
    }

    const leftArchivedAt = left.archived_at ?? left.updated_at;
    const rightArchivedAt = right.archived_at ?? right.updated_at;
    return rightArchivedAt.localeCompare(leftArchivedAt);
  });
}

function timelineRatio(okr: Okr, today: string) {
  const totalDays = Math.max(1, diffInDays(okr.start_date, okr.end_date));
  const elapsedDays = diffInDays(okr.start_date, today);
  return clamp(elapsedDays / totalDays);
}

function keyResultProgress(keyResult: KeyResult) {
  const range = keyResult.target_value - keyResult.start_value;
  if (range === 0) return keyResult.current_value >= keyResult.target_value ? 1 : 0;
  return (keyResult.current_value - keyResult.start_value) / range;
}

function keyResultProgressPercent(keyResult: KeyResult) {
  return clampPercentage(keyResultProgress(keyResult) * 100);
}

function objectiveProgress(okr: Okr) {
  if (okr.key_results.length === 0) return 0;
  const total = okr.key_results.reduce((sum, keyResult) => sum + keyResultProgressPercent(keyResult), 0);
  return total / okr.key_results.length;
}

function classifyHealth(delta: number): KeyResultHealth {
  if (delta >= 0.1) return "ahead";
  if (delta >= -0.1) return "on_track";
  if (delta >= -0.25) return "off_track";
  return "critical";
}

function keyResultHealth(okr: Okr, keyResult: KeyResult, today: string): KeyResultHealth | null {
  if (okr.is_archived) return null;
  const expected = timelineRatio(okr, today);
  const actual = keyResultProgress(keyResult);
  return classifyHealth(actual - expected);
}

function healthLabel(health: KeyResultHealth) {
  if (health === "on_track") return "On track";
  if (health === "off_track") return "Off track";
  if (health === "critical") return "Critical";
  return "Ahead";
}

function healthStyle(health: KeyResultHealth) {
  if (health === "ahead") {
    return {
      backgroundColor: "color-mix(in srgb, var(--success-tint) 88%, transparent)",
      color: "var(--success)",
    };
  }

  if (health === "on_track") {
    return {
      backgroundColor: "color-mix(in srgb, var(--accent-tint) 82%, transparent)",
      color: "var(--accent)",
    };
  }

  if (health === "off_track") {
    return {
      backgroundColor: "color-mix(in srgb, var(--background-subtle) 92%, transparent)",
      color: "var(--foreground-muted)",
    };
  }

  return {
    backgroundColor: "color-mix(in srgb, var(--danger-tint) 86%, transparent)",
    color: "var(--danger)",
  };
}

function timelineSummary(okr: Okr, today: string) {
  if (okr.is_archived) {
    return {
      label: okr.archived_at ? `Archived ${formatDateLabel(okr.archived_at.slice(0, 10))}` : "Archived",
      secondary: formatDateRange(okr.start_date, okr.end_date),
    };
  }

  const daysUntilEnd = diffInDays(today, okr.end_date);
  const daysUntilStart = diffInDays(today, okr.start_date);

  if (daysUntilStart > 0) {
    return {
      label: `${daysUntilStart} day${daysUntilStart === 1 ? "" : "s"} until start`,
      secondary: `${Math.round(timelineRatio(okr, today) * 100)}% of time elapsed`,
    };
  }

  if (daysUntilEnd >= 0) {
    return {
      label: `${daysUntilEnd} day${daysUntilEnd === 1 ? "" : "s"} left`,
      secondary: `${Math.round(timelineRatio(okr, today) * 100)}% of time elapsed`,
    };
  }

  const overdueDays = Math.abs(daysUntilEnd);
  return {
    label: `${overdueDays} day${overdueDays === 1 ? "" : "s"} past end date`,
    secondary: `${Math.round(timelineRatio(okr, today) * 100)}% of time elapsed`,
  };
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full"
      style={{ backgroundColor: "color-mix(in srgb, var(--background-elevated) 86%, var(--background))" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-200"
        style={{
          width: `${clampPercentage(value)}%`,
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--accent) 82%, white), color-mix(in srgb, var(--success) 46%, var(--accent)))",
        }}
      />
    </div>
  );
}

function HoverAction({
  children,
  title,
  onClick,
  disabled = false,
  tone = "default",
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
        tone === "danger" ? "sm:hover:brightness-95" : ""
      } opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`}
      style={
        tone === "danger"
          ? {
              borderColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--danger-tint) 56%, transparent)",
              color: "var(--danger)",
            }
          : {
              borderColor: "color-mix(in srgb, var(--card-border) 62%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
              color: "var(--foreground-muted)",
            }
      }
    >
      {children}
    </button>
  );
}

function InlineGuide({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div
      className="rounded-[24px] border px-4 py-4"
      style={{
        borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--accent-tint) 26%, var(--background-elevated))",
      }}
    >
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <p key={item} className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function GuestOkrPage() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <main className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="surface-card rounded-[28px] px-6 py-8 sm:px-8 sm:py-10">
          <span
            className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
          >
            Personal OKRs
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Keep a few real objectives visible and know early when a key result is slipping.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Set dates, define measurable key results, and review trajectory in a lightweight page that matches the task
            workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="button-primary rounded-full px-5 py-3 text-sm font-semibold">
              Sign in to track OKRs
            </Link>
            <Link href="/" className="button-secondary rounded-full px-5 py-3 text-sm font-semibold">
              Back to tasks
            </Link>
          </div>
        </section>

        <aside className="surface-card rounded-[28px] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Objective preview</p>
              <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                What the signed-in page looks like.
              </p>
            </div>
            <span className="status-badge rounded-full px-3 py-1 text-xs font-medium">Preview</span>
          </div>

          <article
            className="mt-6 rounded-[28px] border px-4 py-4"
            style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Build a weekly planning habit</p>
                <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                  Apr 1, 2025 - Jun 30, 2025
                </p>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-medium" style={healthStyle("on_track")}>
                On track
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">72% objective progress</p>
                <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                  34 days left
                </p>
              </div>
              <div className="mt-2">
                <ProgressBar value={72} />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {[
                ["Weekly review sessions", "Start 0, now 8, target 12", "Ahead"],
                ["Protected deep-work blocks", "Start 0, now 21, target 30", "On track"],
              ].map(([titleText, metric, label]) => (
                <div key={titleText} className="surface-subtle rounded-3xl px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{titleText}</p>
                    <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={healthStyle(label === "Ahead" ? "ahead" : "on_track")}>
                      {label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                    {metric}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </main>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-44 rounded-xl" />
      <div className="skeleton h-44 rounded-[28px]" />
      <div className="skeleton h-44 rounded-[28px]" />
      <div className="skeleton h-44 rounded-[28px]" />
    </div>
  );
}

export default function OkrsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [okrs, setOkrs] = useState<Okr[]>([]);
  const [view, setView] = useState<OkrView>("active");
  const [isLoading, setIsLoading] = useState(false);
  const [objectiveEditor, setObjectiveEditor] = useState<ObjectiveEditorState>(null);
  const [objectiveTitle, setObjectiveTitle] = useState("");
  const [objectiveDescription, setObjectiveDescription] = useState("");
  const [objectiveStartDate, setObjectiveStartDate] = useState(localTodayString());
  const [objectiveEndDate, setObjectiveEndDate] = useState(localTodayString());
  const [isObjectiveSaving, setIsObjectiveSaving] = useState(false);
  const [keyResultEditor, setKeyResultEditor] = useState<KeyResultEditorState>(null);
  const [keyResultTitle, setKeyResultTitle] = useState("");
  const [keyResultStartValue, setKeyResultStartValue] = useState("0");
  const [keyResultCurrentValue, setKeyResultCurrentValue] = useState("0");
  const [keyResultTargetValue, setKeyResultTargetValue] = useState("");
  const [keyResultStepValue, setKeyResultStepValue] = useState("1");
  const [keyResultUnit, setKeyResultUnit] = useState("");
  const [isKeyResultSaving, setIsKeyResultSaving] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
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

  const syncObjective = useCallback((updatedObjective: Okr) => {
    setOkrs((current) => {
      const exists = current.some((item) => item.id === updatedObjective.id);
      const next = exists
        ? current.map((item) => (item.id === updatedObjective.id ? updatedObjective : item))
        : [...current, updatedObjective];
      return sortOkrs(next);
    });
  }, []);

  const removeObjective = useCallback((objectiveId: number) => {
    setOkrs((current) => current.filter((item) => item.id !== objectiveId));
  }, []);

  const loadOkrs = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await get("/planning/okrs");

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as Okr[];
      setOkrs(sortOkrs(data));
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load objectives");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasSessionCookie() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadOkrs();
  }, [authState, loadOkrs]);

  const today = useMemo(() => localTodayString(), []);
  const activeOkrs = useMemo(() => okrs.filter((okr) => !okr.is_archived), [okrs]);
  const archivedOkrs = useMemo(() => okrs.filter((okr) => okr.is_archived), [okrs]);
  const visibleOkrs = view === "active" ? activeOkrs : archivedOkrs;
  const averageProgress = useMemo(() => {
    if (activeOkrs.length === 0) return 0;
    return activeOkrs.reduce((sum, okr) => sum + objectiveProgress(okr), 0) / activeOkrs.length;
  }, [activeOkrs]);
  const keyResultsCount = useMemo(
    () => activeOkrs.reduce((sum, okr) => sum + okr.key_results.length, 0),
    [activeOkrs],
  );

  function resetObjectiveForm() {
    const todayValue = localTodayString();
    const future = new Date(parseDateString(todayValue).getTime() + 90 * DAY_IN_MS);
    const futureLabel = `${future.getUTCFullYear()}-${String(future.getUTCMonth() + 1).padStart(2, "0")}-${String(future.getUTCDate()).padStart(2, "0")}`;

    setObjectiveTitle("");
    setObjectiveDescription("");
    setObjectiveStartDate(todayValue);
    setObjectiveEndDate(futureLabel);
  }

  function openCreateObjectiveModal() {
    resetObjectiveForm();
    setObjectiveEditor({ mode: "create" });
  }

  function openEditObjectiveModal(objective: Okr) {
    setObjectiveTitle(objective.title);
    setObjectiveDescription(objective.description ?? "");
    setObjectiveStartDate(objective.start_date);
    setObjectiveEndDate(objective.end_date);
    setObjectiveEditor({ mode: "edit", objective });
  }

  function closeObjectiveModal(force = false) {
    if (!force && isObjectiveSaving) return;
    setObjectiveEditor(null);
  }

  function openKeyResultModal(objective: Okr, keyResult: KeyResult | null = null) {
    setKeyResultTitle(keyResult?.title ?? "");
    setKeyResultStartValue(String(keyResult?.start_value ?? 0));
    setKeyResultCurrentValue(String(keyResult?.current_value ?? keyResult?.start_value ?? 0));
    setKeyResultTargetValue(keyResult ? String(keyResult.target_value) : "");
    setKeyResultStepValue(String(keyResult?.step_value ?? 1));
    setKeyResultUnit(keyResult?.unit ?? "");
    setKeyResultEditor({ objective, keyResult });
  }

  function closeKeyResultModal(force = false) {
    if (!force && isKeyResultSaving) return;
    setKeyResultEditor(null);
  }

  async function handleSaveObjective(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedTitle = objectiveTitle.trim();
    if (!cleanedTitle) return;

    if (objectiveEndDate < objectiveStartDate) {
      pushToast("error", "End date must be on or after start date.");
      return;
    }

    setIsObjectiveSaving(true);

    try {
      const payload = {
        title: cleanedTitle,
        description: objectiveDescription.trim() ? objectiveDescription.trim() : null,
        start_date: objectiveStartDate,
        end_date: objectiveEndDate,
      };

      const response =
        objectiveEditor?.mode === "edit"
          ? await put(`/planning/okrs/${objectiveEditor.objective.id}`, payload)
          : await post("/planning/okrs", payload);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedObjective = (await response.json()) as Okr;
      syncObjective(updatedObjective);
      closeObjectiveModal(true);
      pushToast("success", objectiveEditor?.mode === "edit" ? "Objective updated." : "Objective created.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to save objective");
    } finally {
      setIsObjectiveSaving(false);
    }
  }

  async function handleSaveKeyResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyResultEditor) return;

    const cleanedTitle = keyResultTitle.trim();
    const startValue = Number.parseFloat(keyResultStartValue);
    const currentValue = Number.parseFloat(keyResultCurrentValue);
    const targetValue = Number.parseFloat(keyResultTargetValue);
    const stepValue = Number.parseFloat(keyResultStepValue);

    if (!cleanedTitle) return;
    if (![startValue, currentValue, targetValue, stepValue].every(Number.isFinite)) {
      pushToast("error", "Enter valid numeric values.");
      return;
    }
    if (stepValue <= 0) {
      pushToast("error", "Step must be above zero.");
      return;
    }
    if (startValue === targetValue) {
      pushToast("error", "Start and target values must differ.");
      return;
    }

    setIsKeyResultSaving(true);

    try {
      const payload = {
        title: cleanedTitle,
        start_value: startValue,
        current_value: currentValue,
        target_value: targetValue,
        step_value: stepValue,
        unit: keyResultUnit.trim() ? keyResultUnit.trim() : null,
      };

      const response = keyResultEditor.keyResult
        ? await put(`/planning/key-results/${keyResultEditor.keyResult.id}`, payload)
        : await post(`/planning/okrs/${keyResultEditor.objective.id}/key-results`, payload);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedObjective = (await response.json()) as Okr;
      syncObjective(updatedObjective);
      closeKeyResultModal(true);
      pushToast("success", keyResultEditor.keyResult ? "Key result updated." : "Key result added.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to save key result");
    } finally {
      setIsKeyResultSaving(false);
    }
  }

  async function handleAdjustKeyResult(objective: Okr, keyResult: KeyResult, direction: "increase" | "decrease") {
    const delta = direction === "increase" ? keyResult.step_value : -keyResult.step_value;
    setBusyActionKey(`adjust-${keyResult.id}-${direction}`);

    try {
      const response = await patch(`/planning/key-results/${keyResult.id}/adjust`, { delta });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedObjective = (await response.json()) as Okr;
      syncObjective(updatedObjective);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update key result");
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleArchiveToggle(objective: Okr) {
    setBusyActionKey(`${objective.is_archived ? "restore" : "archive"}-${objective.id}`);

    try {
      const response = await post(
        objective.is_archived ? `/planning/okrs/${objective.id}/restore` : `/planning/okrs/${objective.id}/archive`,
        {},
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const updatedObjective = (await response.json()) as Okr;
      syncObjective(updatedObjective);
      pushToast("success", objective.is_archived ? "Objective restored." : "Objective archived.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update objective");
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleDeleteObjective(objective: Okr) {
    setBusyActionKey(`delete-objective-${objective.id}`);

    try {
      const response = await del(`/planning/okrs/${objective.id}`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      removeObjective(objective.id);
      setPendingConfirmation(null);
      pushToast("success", "Objective removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove objective");
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleDeleteKeyResult(keyResult: KeyResult) {
    setBusyActionKey(`delete-key-result-${keyResult.id}`);

    try {
      const response = await del(`/planning/key-results/${keyResult.id}`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setOkrs((current) =>
        current.map((okr) =>
          okr.key_results.some((item) => item.id === keyResult.id)
            ? { ...okr, key_results: okr.key_results.filter((item) => item.id !== keyResult.id) }
            : okr,
        ),
      );
      setPendingConfirmation(null);
      pushToast("success", "Key result removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove key result");
    } finally {
      setBusyActionKey(null);
    }
  }

  if (authState === "checking") {
    return <DashboardLoadingState />;
  }

  if (authState === "guest") {
    return <GuestOkrPage />;
  }

  const isConfirmationBusy = busyActionKey !== null;

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
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">My OKRs</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              A lightweight personal system: set a dated objective, define a few measurable outcomes, and catch drift
              early.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                  color: "var(--foreground-muted)",
                }}
              >
                {activeOkrs.length} active
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--accent-tint) 60%, transparent)",
                  color: "var(--accent)",
                }}
              >
                {archivedOkrs.length} archived
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                  color: "var(--foreground-muted)",
                }}
              >
                {keyResultsCount} active key results
              </span>
              <span className="rounded-full px-3 py-1.5 text-xs font-medium" style={healthStyle("ahead")}>
                {Math.round(averageProgress)}% average progress
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className="surface-subtle inline-flex rounded-full p-1"
              style={{ border: "1px solid color-mix(in srgb, var(--card-border) 72%, transparent)" }}
            >
              {[
                { value: "active" as const, label: "Active" },
                { value: "archived" as const, label: "Archived" },
              ].map((option) => {
                const active = view === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setView(option.value)}
                    className="rounded-full px-4 py-2 text-sm font-medium"
                    style={
                      active
                        ? { backgroundColor: "var(--accent-tint)", color: "var(--accent)" }
                        : { color: "var(--foreground-muted)" }
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={openCreateObjectiveModal}
              className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add objective
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 flex-1">
        {isLoading ? (
          <div className="space-y-3" aria-live="polite">
            <div className="skeleton h-44 rounded-[32px]" />
            <div className="skeleton h-44 rounded-[32px]" />
            <div className="skeleton h-44 rounded-[32px]" />
          </div>
        ) : visibleOkrs.length === 0 ? (
          <div className="surface-card rounded-[32px] px-5 py-10 sm:px-6">
            <h3 className="text-lg font-semibold">{view === "active" ? "No active objectives yet" : "No archived objectives yet"}</h3>
            <p className="mt-2 max-w-xl text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              {view === "active"
                ? "Create one objective with a start date, end date, and a few key results."
                : "Archive finished or paused objectives to keep the active list tight."}
            </p>
            {view === "active" ? (
              <button
                type="button"
                onClick={openCreateObjectiveModal}
                className="button-primary mt-5 inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add objective
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleOkrs.map((okr) => {
              const progress = objectiveProgress(okr);
              const timeline = timelineSummary(okr, today);
              const archiveBusyKey = `${okr.is_archived ? "restore" : "archive"}-${okr.id}`;

              return (
                <article key={okr.id} className="surface-card group rounded-[32px] p-5 sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={
                            okr.is_archived
                              ? {
                                  backgroundColor: "color-mix(in srgb, var(--background-subtle) 92%, transparent)",
                                  color: "var(--foreground-muted)",
                                }
                              : {
                                  backgroundColor: "color-mix(in srgb, var(--accent-tint) 70%, transparent)",
                                  color: "var(--accent)",
                                }
                          }
                        >
                          {okr.is_archived ? "Archived" : "Active"}
                        </span>
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                            color: "var(--foreground-muted)",
                          }}
                        >
                          {formatDateRange(okr.start_date, okr.end_date)}
                        </span>
                      </div>

                      <h3 className="mt-4 text-2xl font-semibold tracking-tight">{okr.title}</h3>
                      <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--foreground-muted)" }}>
                        {okr.description?.trim() || "Add a short note so the objective has a clear intent behind it."}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                            color: "var(--foreground-muted)",
                          }}
                        >
                          {timeline.label}
                        </span>
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                            color: "var(--foreground-muted)",
                          }}
                        >
                          {timeline.secondary}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div
                        className="min-w-[220px] rounded-[28px] border px-4 py-4"
                        style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">Objective progress</p>
                          <p className="text-sm font-semibold">{Math.round(progress)}%</p>
                        </div>
                        <div className="mt-3">
                          <ProgressBar value={progress} />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
                          <span>{okr.key_results.length} key results</span>
                          <span>{okr.is_archived ? "Health paused" : "Checked against timeline"}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <HoverAction title="Add key result" onClick={() => openKeyResultModal(okr)}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </HoverAction>
                        <HoverAction title="Edit objective" onClick={() => openEditObjectiveModal(okr)}>
                          <PencilLine className="h-4 w-4" aria-hidden="true" />
                        </HoverAction>
                        <HoverAction
                          title={okr.is_archived ? "Restore objective" : "Archive objective"}
                          onClick={() => void handleArchiveToggle(okr)}
                          disabled={busyActionKey === archiveBusyKey}
                        >
                          {busyActionKey === archiveBusyKey ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : okr.is_archived ? (
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Archive className="h-4 w-4" aria-hidden="true" />
                          )}
                        </HoverAction>
                        <HoverAction
                          title="Delete objective"
                          tone="danger"
                          onClick={() => setPendingConfirmation({ kind: "objective", objective: okr })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </HoverAction>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    {okr.key_results.length === 0 ? (
                      <div
                        className="rounded-[28px] border px-4 py-5"
                        style={{
                          borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)",
                          backgroundColor: "color-mix(in srgb, var(--background-elevated) 84%, transparent)",
                        }}
                      >
                        <p className="text-sm font-semibold">No key results yet</p>
                        <p className="mt-1 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
                          Add 2 to 4 measurable outcomes so this objective can be reviewed honestly.
                        </p>
                      </div>
                    ) : (
                      okr.key_results.map((keyResult) => {
                        const health = keyResultHealth(okr, keyResult, today);
                        const adjustDownKey = `adjust-${keyResult.id}-decrease`;
                        const adjustUpKey = `adjust-${keyResult.id}-increase`;

                        return (
                          <article key={keyResult.id} className="surface-subtle group rounded-[28px] px-4 py-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-semibold">{keyResult.title}</p>
                                  {health ? (
                                    <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={healthStyle(health)}>
                                      {healthLabel(health)}
                                    </span>
                                  ) : (
                                    <span
                                      className="rounded-full px-2.5 py-1 text-xs font-medium"
                                      style={{
                                        backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                                        color: "var(--foreground-muted)",
                                      }}
                                    >
                                      Archived
                                    </span>
                                  )}
                                </div>

                                <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
                                  Start {formatMetricValue(keyResult.start_value)}, now {formatMetricValue(keyResult.current_value)}, target{" "}
                                  {formatMetricValue(keyResult.target_value)}
                                  {keyResult.unit ? ` ${keyResult.unit}` : ""}
                                </p>
                                <p className="mt-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                                  Step {formatMetricValue(keyResult.step_value)}
                                  {keyResult.unit ? ` ${keyResult.unit}` : ""}
                                </p>

                                <div className="mt-3">
                                  <ProgressBar value={keyResultProgressPercent(keyResult)} />
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <div
                                  className="inline-flex items-center gap-1 rounded-full border px-1 py-1"
                                  style={{
                                    borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)",
                                    backgroundColor: "color-mix(in srgb, var(--background-elevated) 88%, transparent)",
                                  }}
                                >
                                  <button
                                    type="button"
                                    aria-label="Decrease current value"
                                    title="Decrease current value"
                                    disabled={busyActionKey === adjustDownKey}
                                    onClick={() => void handleAdjustKeyResult(okr, keyResult, "decrease")}
                                    className="flex h-9 w-9 items-center justify-center rounded-full"
                                    style={{ color: "var(--foreground-muted)" }}
                                  >
                                    {busyActionKey === adjustDownKey ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Minus className="h-4 w-4" aria-hidden="true" />
                                    )}
                                  </button>
                                  <span className="min-w-16 text-center text-sm font-semibold">
                                    {formatMetricValue(keyResult.current_value)}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label="Increase current value"
                                    title="Increase current value"
                                    disabled={busyActionKey === adjustUpKey}
                                    onClick={() => void handleAdjustKeyResult(okr, keyResult, "increase")}
                                    className="flex h-9 w-9 items-center justify-center rounded-full"
                                    style={{ color: "var(--foreground-muted)" }}
                                  >
                                    {busyActionKey === adjustUpKey ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Plus className="h-4 w-4" aria-hidden="true" />
                                    )}
                                  </button>
                                </div>

                                <div className="flex gap-2">
                                  <HoverAction title="Edit key result" onClick={() => openKeyResultModal(okr, keyResult)}>
                                    <PencilLine className="h-4 w-4" aria-hidden="true" />
                                  </HoverAction>
                                  <HoverAction
                                    title="Delete key result"
                                    tone="danger"
                                    onClick={() =>
                                      setPendingConfirmation({
                                        kind: "key_result",
                                        objectiveTitle: okr.title,
                                        keyResult,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </HoverAction>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        isOpen={objectiveEditor !== null}
        onClose={() => closeObjectiveModal()}
        title={objectiveEditor?.mode === "edit" ? "Edit objective" : "Create objective"}
        description="Use a start date and end date so key results can be judged against time, not only raw totals."
      >
        <form onSubmit={handleSaveObjective} className="space-y-4">
          <div>
            <label htmlFor="okr-title" className="text-sm font-semibold">
              Objective
            </label>
            <input
              id="okr-title"
              value={objectiveTitle}
              onChange={(event) => setObjectiveTitle(event.target.value)}
              placeholder="Build a stronger weekly planning habit"
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="okr-description" className="text-sm font-semibold">
              Notes
            </label>
            <textarea
              id="okr-description"
              value={objectiveDescription}
              onChange={(event) => setObjectiveDescription(event.target.value)}
              placeholder="Why this matters in the current cycle"
              className="field mt-2 min-h-28 rounded-2xl px-4 py-3 text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="okr-start-date" className="text-sm font-semibold">
                Start date
              </label>
              <input
                id="okr-start-date"
                type="date"
                value={objectiveStartDate}
                onChange={(event) => setObjectiveStartDate(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="okr-end-date" className="text-sm font-semibold">
                End date
              </label>
              <input
                id="okr-end-date"
                type="date"
                value={objectiveEndDate}
                onChange={(event) => setObjectiveEndDate(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>
          </div>

          <InlineGuide
            title="Objective guide"
            items={[
              "Keep it qualitative and outcome-focused. Save the numbers for key results.",
              "Use a real time window. Health labels become meaningful only when the dates are intentional.",
              "If this objective is no longer active, archive it instead of widening the active list.",
            ]}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => closeObjectiveModal()}
              disabled={isObjectiveSaving}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isObjectiveSaving}
              className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isObjectiveSaving ? "Saving..." : objectiveEditor?.mode === "edit" ? "Save changes" : "Create objective"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={keyResultEditor !== null}
        onClose={() => closeKeyResultModal()}
        title={keyResultEditor?.keyResult ? "Edit key result" : "Add key result"}
        description="Set the numeric starting point and target so the page can judge whether progress is ahead or slipping."
      >
        <form onSubmit={handleSaveKeyResult} className="space-y-4">
          <div>
            <label htmlFor="key-result-title" className="text-sm font-semibold">
              Key result
            </label>
            <input
              id="key-result-title"
              value={keyResultTitle}
              onChange={(event) => setKeyResultTitle(event.target.value)}
              placeholder="Complete 12 weekly reviews"
              className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="key-result-start-value" className="text-sm font-semibold">
                Start value
              </label>
              <input
                id="key-result-start-value"
                value={keyResultStartValue}
                onChange={(event) => setKeyResultStartValue(event.target.value)}
                inputMode="decimal"
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="key-result-current-value" className="text-sm font-semibold">
                Current value
              </label>
              <input
                id="key-result-current-value"
                value={keyResultCurrentValue}
                onChange={(event) => setKeyResultCurrentValue(event.target.value)}
                inputMode="decimal"
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="key-result-target-value" className="text-sm font-semibold">
                Target value
              </label>
              <input
                id="key-result-target-value"
                value={keyResultTargetValue}
                onChange={(event) => setKeyResultTargetValue(event.target.value)}
                inputMode="decimal"
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="key-result-step-value" className="text-sm font-semibold">
                +/- step
              </label>
              <input
                id="key-result-step-value"
                value={keyResultStepValue}
                onChange={(event) => setKeyResultStepValue(event.target.value)}
                inputMode="decimal"
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="key-result-unit" className="text-sm font-semibold">
                Unit
              </label>
              <input
                id="key-result-unit"
                value={keyResultUnit}
                onChange={(event) => setKeyResultUnit(event.target.value)}
                placeholder="sessions"
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
              />
            </div>
          </div>

          <InlineGuide
            title="Key result guide"
            items={[
              "Use a measurable metric, not a task list item.",
              "Start and target can move up or down. The page compares current progress against the objective timeline.",
              "Choose a step size that matches how you update this metric in real life.",
            ]}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => closeKeyResultModal()}
              disabled={isKeyResultSaving}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isKeyResultSaving}
              className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isKeyResultSaving ? "Saving..." : keyResultEditor?.keyResult ? "Save changes" : "Add key result"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={pendingConfirmation !== null}
        onClose={() => {
          if (isConfirmationBusy) return;
          setPendingConfirmation(null);
        }}
        title={pendingConfirmation?.kind === "objective" ? "Remove objective?" : "Remove key result?"}
        description={
          pendingConfirmation?.kind === "objective"
            ? "This removes the objective and every key result under it."
            : "This removes the selected measurable outcome from the objective."
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingConfirmation?.kind === "objective"
              ? `Remove "${pendingConfirmation.objective.title}"?`
              : pendingConfirmation?.kind === "key_result"
                ? `Remove "${pendingConfirmation.keyResult.title}" from "${pendingConfirmation.objectiveTitle}"?`
                : ""}
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
              disabled={isConfirmationBusy}
              onClick={() =>
                pendingConfirmation?.kind === "objective"
                  ? void handleDeleteObjective(pendingConfirmation.objective)
                  : pendingConfirmation?.kind === "key_result"
                    ? void handleDeleteKeyResult(pendingConfirmation.keyResult)
                    : undefined
              }
              className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isConfirmationBusy ? "Removing..." : pendingConfirmation?.kind === "objective" ? "Remove objective" : "Remove key result"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
