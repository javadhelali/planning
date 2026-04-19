"use client";

import { isValidJalaaliDate, toGregorian, toJalaali } from "jalaali-js";
import {
  Activity,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  LoaderCircle,
  PencilLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, hasPlanningSession, post, put } from "../../utilities/api";
import { ActionMenu, ActionMenuItem } from "@/components/site/action-menu";
import Modal from "@/components/site/modal";
import ToastStack from "@/components/site/toast-stack";

type AuthState = "checking" | "authenticated" | "guest";
type ActivitySource = "manual" | "tasks" | "okrs" | "glossary" | "missions";

type ActivityEvent = {
  id: number;
  user_id: number;
  source: ActivitySource;
  text: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

type SourceFilter = "all" | ActivitySource;

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

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "tasks", label: "Tasks" },
  { value: "okrs", label: "OKRs" },
  { value: "glossary", label: "Glossary" },
  { value: "missions", label: "Missions" },
];

const PAGE_SIZE = 10;
const EMPTY_JALALI_DATE: JalaliDateParts = { year: "", month: "", day: "" };
const CARD_ACTIONS_VISIBILITY_CLASS =
  "md:invisible md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover:visible md:group-hover:opacity-100 md:group-hover:pointer-events-auto";

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.detail === "string") return payload.detail;
  return `Request failed (${response.status})`;
}

function sourceLabel(source: ActivitySource) {
  if (source === "okrs") return "OKRs";
  if (source === "manual") return "Manual";
  if (source === "tasks") return "Tasks";
  if (source === "glossary") return "Glossary";
  return "Missions";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const jalali = toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${jalali.jy}/${String(jalali.jm).padStart(2, "0")}/${String(jalali.jd).padStart(2, "0")} ${hours}:${minutes}`;
}

function toJalaliDateParts(value: string): JalaliDateParts {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ...EMPTY_JALALI_DATE };

  const jalali = toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return {
    year: String(jalali.jy),
    month: String(jalali.jm).padStart(2, "0"),
    day: String(jalali.jd).padStart(2, "0"),
  };
}

function toTimePart(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function toIsoFromJalaliDateAndTime(jalaliDate: JalaliDateParts, timeValue: string) {
  const year = Number.parseInt(jalaliDate.year, 10);
  const month = Number.parseInt(jalaliDate.month, 10);
  const day = Number.parseInt(jalaliDate.day, 10);

  if (!year || !month || !day) {
    throw new Error("Enter a complete Jalali date.");
  }

  if (!isValidJalaaliDate(year, month, day)) {
    throw new Error("Enter a valid Jalali date.");
  }

  const [rawHour, rawMinute] = timeValue.split(":");
  const hour = Number.parseInt(rawHour ?? "", 10);
  const minute = Number.parseInt(rawMinute ?? "", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Enter a valid time.");
  }

  const gregorian = toGregorian(year, month, day);
  const localDate = new Date(gregorian.gy, gregorian.gm - 1, gregorian.gd, hour, minute, 0, 0);
  if (Number.isNaN(localDate.getTime())) {
    throw new Error("Enter a valid date and time.");
  }
  return localDate.toISOString();
}

function metadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined);
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
            Activity Timeline
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Capture system activity and personal notes in one stream.</h1>
          <p className="mt-4 max-w-xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
            Every update in tasks, OKRs, glossary, and missions is tracked automatically. You can also add manual reflections.
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
          <p className="text-sm font-semibold">Timeline preview</p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            Latest events appear first; older events are on later pages.
          </p>
          <div className="mt-6 space-y-3">
            {[
              ["Glossary", "Added glossary term \"LTV\"."],
              ["OKRs", "Updated KR \"Activation\" in OKR \"Q2 Growth\" to 42."],
              ["Manual", "Skipped workout today due to fatigue."],
            ].map(([source, text]) => (
              <article key={`${source}-${text}`} className="surface-subtle rounded-3xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
                  >
                    {source}
                  </span>
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    Today
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6">{text}</p>
              </article>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-56 rounded-2xl" />
      <div className="skeleton h-24 rounded-[28px]" />
      <div className="skeleton h-24 rounded-[28px]" />
      <div className="skeleton h-24 rounded-[28px]" />
    </div>
  );
}

export default function ActivityPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [text, setText] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const [editingEvent, setEditingEvent] = useState<ActivityEvent | null>(null);
  const [editText, setEditText] = useState("");
  const [editOccurredDate, setEditOccurredDate] = useState<JalaliDateParts>({ ...EMPTY_JALALI_DATE });
  const [editOccurredTime, setEditOccurredTime] = useState("");
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<ActivityEvent | null>(null);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);

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

  const loadEvents = useCallback(async () => {
    setIsLoading(true);

    try {
      const params = new URLSearchParams({ limit: "500" });
      if (sourceFilter !== "all") {
        params.set("source", sourceFilter);
      }

      const response = await get(`/planning/activity-events?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as ActivityEvent[];
      setEvents(data);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load activity events");
    } finally {
      setIsLoading(false);
    }
  }, [sourceFilter, pushToast]);

  useEffect(() => {
    setAuthState(hasPlanningSession() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadEvents();
  }, [authState, loadEvents]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sourceFilter]);

  const orderedEvents = useMemo(() => {
    return [...events].sort((left, right) => {
      if (left.occurred_at !== right.occurred_at) {
        return right.occurred_at.localeCompare(left.occurred_at);
      }
      return right.id - left.id;
    });
  }, [events]);

  const totalPages = Math.max(1, Math.ceil(orderedEvents.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return orderedEvents.slice(start, start + PAGE_SIZE);
  }, [orderedEvents, currentPage]);

  const startIndex = orderedEvents.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(currentPage * PAGE_SIZE, orderedEvents.length);

  const openEditModal = useCallback((activityEvent: ActivityEvent) => {
    setOpenMenuKey(null);
    setEditingEvent(activityEvent);
    setEditText(activityEvent.text);
    setEditOccurredDate(toJalaliDateParts(activityEvent.occurred_at));
    setEditOccurredTime(toTimePart(activityEvent.occurred_at));
  }, []);

  const closeEditModal = useCallback((force = false) => {
    if (!force && isEditSubmitting) return;
    setEditingEvent(null);
  }, [isEditSubmitting]);

  const handleEditOccurredDateChange = useCallback((field: keyof JalaliDateParts, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(0, field === "year" ? 4 : 2);
    setEditOccurredDate((current) => ({ ...current, [field]: sanitized }));
  }, []);

  const handleCreateManualEvent = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const cleanedText = text.trim();
      if (!cleanedText) {
        pushToast("error", "Entry text is required.");
        return;
      }

      setIsSubmitting(true);

      try {
        const response = await post("/planning/activity-events/manual", {
          text: cleanedText,
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        setText("");
        setCurrentPage(1);
        pushToast("success", "Manual activity recorded.");
        await loadEvents();
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "Failed to create manual activity event");
      } finally {
        setIsSubmitting(false);
      }
    },
    [text, loadEvents, pushToast],
  );

  const handleUpdateManualEvent = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editingEvent) return;

      const cleanedText = editText.trim();
      if (!cleanedText) {
        pushToast("error", "Entry text is required.");
        return;
      }

      setIsEditSubmitting(true);

      try {
        const occurredAtIso = toIsoFromJalaliDateAndTime(editOccurredDate, editOccurredTime);
        const response = await put(`/planning/activity-events/${editingEvent.id}/manual`, {
          text: cleanedText,
          occurred_at: occurredAtIso,
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        closeEditModal(true);
        pushToast("success", "Manual activity updated.");
        await loadEvents();
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : "Failed to update manual activity");
      } finally {
        setIsEditSubmitting(false);
      }
    },
    [editingEvent, editText, editOccurredDate, editOccurredTime, closeEditModal, loadEvents, pushToast],
  );

  const handleDeleteEvent = useCallback(async () => {
    if (!pendingDeleteEvent) return;

    setIsDeleteSubmitting(true);

    try {
      const response = await del(`/planning/activity-events/${pendingDeleteEvent.id}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPendingDeleteEvent(null);
      setEditingEvent(null);
      pushToast("success", "Activity deleted.");
      await loadEvents();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to delete activity");
    } finally {
      setIsDeleteSubmitting(false);
    }
  }, [pendingDeleteEvent, loadEvents, pushToast]);

  if (authState === "checking") {
    return <LoadingState />;
  }

  if (authState === "guest") {
    return <GuestHome />;
  }

  return (
    <div className="flex min-h-[calc(100vh-112px)] min-w-0 flex-col">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <section className="px-1 pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-4xl flex-1">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Activity Timeline</h2>
            <p className="mt-1 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              Latest events are shown first. Timeline order always follows occurred date/time.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                {orderedEvents.length} events
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                Page {currentPage} of {totalPages}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
              <select
                className="field h-10 rounded-full pl-8 pr-8 text-xs font-semibold uppercase tracking-[0.08em]"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                aria-label="Filter timeline source"
              >
                {SOURCE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => void loadEvents()} className="button-secondary h-10 rounded-full px-4 text-xs font-semibold uppercase tracking-[0.08em]" disabled={isLoading}>
              {isLoading ? "Loading" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 flex-1 space-y-3 pb-28">
        {isLoading ? (
          <div className="space-y-3" aria-live="polite">
            <div className="skeleton h-24 rounded-[28px]" />
            <div className="skeleton h-24 rounded-[28px]" />
            <div className="skeleton h-24 rounded-[28px]" />
          </div>
        ) : paginatedEvents.length === 0 ? (
          <div className="surface-card px-5 py-10 sm:px-6" style={{ borderRadius: "32px" }}>
            <h3 className="text-lg font-semibold">No events for this filter</h3>
            <p className="mt-2 max-w-xl text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              Try another source filter or add a manual entry from the quick composer below.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {paginatedEvents.map((activityEvent) => {
                const entries = metadataEntries(activityEvent.metadata);
                const isManual = activityEvent.source === "manual";

                return (
                  <article key={activityEvent.id} className="surface-subtle group rounded-[28px] p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em]"
                        style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}
                      >
                        {sourceLabel(activityEvent.source)}
                      </span>

                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          {formatDateTime(activityEvent.occurred_at)}
                        </span>
                        <div className={CARD_ACTIONS_VISIBILITY_CLASS}>
                          <ActionMenu
                            menuKey={`activity-${activityEvent.id}`}
                            openMenuKey={openMenuKey}
                            onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                            adaptiveDirection
                          >
                            {isManual ? (
                              <ActionMenuItem onClick={() => openEditModal(activityEvent)}>
                                <span className="inline-flex items-center gap-2">
                                  <PencilLine className="h-4 w-4" aria-hidden="true" />
                                  Edit manual entry
                                </span>
                              </ActionMenuItem>
                            ) : null}
                            <ActionMenuItem
                              tone="danger"
                              onClick={() => {
                                setOpenMenuKey(null);
                                setPendingDeleteEvent(activityEvent);
                              }}
                            >
                              <span className="inline-flex items-center gap-2">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                Delete activity
                              </span>
                            </ActionMenuItem>
                          </ActionMenu>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6 sm:text-[15px]">{activityEvent.text}</p>

                    {entries.length > 0 ? (
                      <details className="mt-2">
                        <summary className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--foreground-muted)" }}>
                          Metadata
                        </summary>
                        <pre
                          className="mt-2 overflow-x-auto rounded-2xl border p-3 text-xs"
                          style={{
                            borderColor: "color-mix(in srgb, var(--card-border) 70%, transparent)",
                            backgroundColor: "color-mix(in srgb, var(--background-elevated) 92%, transparent)",
                          }}
                        >
                          {JSON.stringify(activityEvent.metadata, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <div className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-3xl px-4 py-3 sm:px-5">
              <p className="text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
                Showing {startIndex}-{endIndex} of {orderedEvents.length}
              </p>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage <= 1}
                  className="button-secondary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold uppercase tracking-[0.08em] disabled:opacity-60"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Prev
                </button>
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--foreground-muted)" }}>
                  {currentPage}/{totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage >= totalPages}
                  className="button-secondary inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold uppercase tracking-[0.08em] disabled:opacity-60"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="sticky bottom-0 z-10 mt-6 px-1 pb-3 pt-8">
        <form onSubmit={handleCreateManualEvent} autoComplete="off" className="task-composer mx-auto max-w-4xl px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ color: "var(--foreground-muted)" }}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>

            <input
              id="new-activity-text"
              name="new-activity-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a manual activity..."
              className="task-composer-input min-h-12 flex-1 bg-transparent text-sm"
              aria-label="Add a manual activity"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={isSubmitting}
            />

            <button
              type="submit"
              disabled={isSubmitting || !text.trim()}
              className="task-composer-send inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0 disabled:opacity-60"
              aria-label={isSubmitting ? "Adding activity" : "Add activity"}
              title={isSubmitting ? "Adding..." : "Add activity"}
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
      </section>

      <Modal
        isOpen={editingEvent !== null}
        onClose={closeEditModal}
        title="Edit manual activity"
        description="Update text and occurred date/time. Timeline sorting uses occurred date/time."
      >
        <form onSubmit={handleUpdateManualEvent} className="space-y-4">
          <div>
            <label htmlFor="edit-activity-text" className="text-sm font-semibold">
              Text
            </label>
            <textarea
              id="edit-activity-text"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              className="field mt-1 min-h-28 rounded-2xl px-3 py-2 text-sm"
              maxLength={4000}
              required
              disabled={isEditSubmitting}
            />
          </div>

          <div>
            <label className="text-sm font-semibold">
              Occurred At (Jalali)
            </label>
            <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <input
                value={editOccurredDate.year}
                onChange={(event) => handleEditOccurredDateChange("year", event.target.value)}
                className="field rounded-2xl px-3 py-2 text-sm"
                placeholder="Year"
                inputMode="numeric"
                disabled={isEditSubmitting}
                required
              />
              <input
                value={editOccurredDate.month}
                onChange={(event) => handleEditOccurredDateChange("month", event.target.value)}
                className="field rounded-2xl px-3 py-2 text-sm"
                placeholder="Month"
                inputMode="numeric"
                disabled={isEditSubmitting}
                required
              />
              <input
                value={editOccurredDate.day}
                onChange={(event) => handleEditOccurredDateChange("day", event.target.value)}
                className="field rounded-2xl px-3 py-2 text-sm"
                placeholder="Day"
                inputMode="numeric"
                disabled={isEditSubmitting}
                required
              />
              <input
                type="time"
                value={editOccurredTime}
                onChange={(event) => setEditOccurredTime(event.target.value)}
                className="field rounded-2xl px-3 py-2 text-sm"
                disabled={isEditSubmitting}
                required
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => closeEditModal()}
              disabled={isEditSubmitting}
              className="button-secondary rounded-full px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isEditSubmitting || !editText.trim()}
              className="button-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {isEditSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={pendingDeleteEvent !== null}
        onClose={() => (isDeleteSubmitting ? undefined : setPendingDeleteEvent(null))}
        title={pendingDeleteEvent?.source === "manual" ? "Delete manual activity?" : "Delete activity?"}
        description="This action cannot be undone."
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingDeleteEvent ? pendingDeleteEvent.text : ""}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDeleteEvent(null)}
              disabled={isDeleteSubmitting}
              className="button-secondary rounded-full px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteEvent()}
              disabled={isDeleteSubmitting}
              className="button-danger inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {isDeleteSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
