"use client";

import { BriefcaseBusiness, ListTodo, LoaderCircle, Target, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { get } from "../utilities/api";

type AuthState = "checking" | "authenticated" | "guest";

type Task = {
  id: number;
  status: "todo" | "done";
};

type KeyResult = {
  id: number;
  start_value: number;
  current_value: number;
  target_value: number;
};

type Okr = {
  id: number;
  start_date: string;
  end_date: string;
  is_archived: boolean;
  key_results: KeyResult[];
};

type MissionStep = {
  id: number;
  is_next: boolean;
};

type Mission = {
  id: number;
  steps: MissionStep[];
};

type Health = "ahead" | "on_track" | "off_track" | "critical";

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

function keyResultProgress(keyResult: KeyResult) {
  const range = keyResult.target_value - keyResult.start_value;
  if (range === 0) return keyResult.current_value >= keyResult.target_value ? 1 : 0;
  return (keyResult.current_value - keyResult.start_value) / range;
}

function keyResultProgressPercent(keyResult: KeyResult) {
  return clamp(keyResultProgress(keyResult)) * 100;
}

function objectiveProgress(okr: Okr) {
  if (okr.key_results.length === 0) return 0;
  const total = okr.key_results.reduce((sum, keyResult) => sum + keyResultProgressPercent(keyResult), 0);
  return total / okr.key_results.length;
}

function timelineRatio(okr: Okr, today: string) {
  const totalDays = Math.max(1, diffInDays(okr.start_date, okr.end_date));
  const elapsedDays = diffInDays(okr.start_date, today);
  return clamp(elapsedDays / totalDays);
}

function classifyHealth(delta: number): Health {
  if (delta >= 0.1) return "ahead";
  if (delta >= -0.1) return "on_track";
  if (delta >= -0.25) return "off_track";
  return "critical";
}

function keyResultHealth(okr: Okr, keyResult: KeyResult, today: string): Health {
  const expected = timelineRatio(okr, today);
  const actual = keyResultProgress(keyResult);
  return classifyHealth(actual - expected);
}

function DashboardLoading() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-52 rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="skeleton h-36 rounded-[28px]" />
        <div className="skeleton h-36 rounded-[28px]" />
      </div>
      <div className="skeleton h-40 rounded-[28px]" />
    </div>
  );
}

function GuestDashboard() {
  return (
    <div className="surface-card rounded-[32px] px-6 py-8 sm:px-8">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dashboard</h2>
      <p className="mt-2 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
        Sign in to see your task and OKR report.
      </p>
      <div className="mt-6">
        <Link href="/login" className="button-primary inline-flex rounded-full px-5 py-3 text-sm font-semibold">
          Sign in
        </Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [okrs, setOkrs] = useState<Okr[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [tasksResponse, okrsResponse, missionsResponse] = await Promise.all([
        get("/planning/tasks"),
        get("/planning/okrs"),
        get("/planning/missions"),
      ]);

      if (!tasksResponse.ok) throw new Error(await readErrorMessage(tasksResponse));
      if (!okrsResponse.ok) throw new Error(await readErrorMessage(okrsResponse));
      if (!missionsResponse.ok) throw new Error(await readErrorMessage(missionsResponse));

      const tasksData = (await tasksResponse.json()) as Task[];
      const okrsData = (await okrsResponse.json()) as Okr[];
      const missionsData = (await missionsResponse.json()) as Mission[];
      setTasks(tasksData);
      setOkrs(okrsData);
      setMissions(missionsData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load dashboard");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthState(hasSessionCookie() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadDashboard();
  }, [authState, loadDashboard]);

  const today = localTodayString();
  const totalTasks = tasks.length;
  const doneTasks = useMemo(() => tasks.filter((task) => task.status === "done").length, [tasks]);
  const todoTasks = totalTasks - doneTasks;
  const totalMissionSteps = useMemo(
    () => missions.reduce((sum, mission) => sum + mission.steps.length, 0),
    [missions],
  );
  const nextStepsCount = useMemo(
    () => missions.reduce((sum, mission) => sum + (mission.steps.some((step) => step.is_next) ? 1 : 0), 0),
    [missions],
  );

  const activeOkrs = useMemo(() => okrs.filter((okr) => !okr.is_archived), [okrs]);
  const archivedOkrs = useMemo(() => okrs.filter((okr) => okr.is_archived), [okrs]);
  const activeKeyResults = useMemo(() => activeOkrs.flatMap((okr) => okr.key_results), [activeOkrs]);

  const averageOkrProgress = useMemo(() => {
    if (activeOkrs.length === 0) return 0;
    const total = activeOkrs.reduce((sum, okr) => sum + objectiveProgress(okr), 0);
    return total / activeOkrs.length;
  }, [activeOkrs]);

  const healthCounts = useMemo(() => {
    const counts: Record<Health, number> = {
      ahead: 0,
      on_track: 0,
      off_track: 0,
      critical: 0,
    };

    activeOkrs.forEach((okr) => {
      okr.key_results.forEach((keyResult) => {
        const health = keyResultHealth(okr, keyResult, today);
        counts[health] += 1;
      });
    });

    return counts;
  }, [activeOkrs, today]);

  const totalRatedKeyResults = healthCounts.ahead + healthCounts.on_track + healthCounts.off_track + healthCounts.critical;
  const healthyRate = totalRatedKeyResults === 0 ? 0 : ((healthCounts.ahead + healthCounts.on_track) / totalRatedKeyResults) * 100;
  const endingSoonCount = useMemo(
    () =>
      activeOkrs.filter((okr) => {
        const daysLeft = diffInDays(today, okr.end_date);
        return daysLeft >= 0 && daysLeft <= 7;
      }).length,
    [activeOkrs, today],
  );
  const overdueCount = useMemo(() => activeOkrs.filter((okr) => diffInDays(today, okr.end_date) < 0).length, [activeOkrs, today]);

  if (authState === "checking") {
    return <DashboardLoading />;
  }

  if (authState === "guest") {
    return <GuestDashboard />;
  }

  if (isLoading) {
    return <DashboardLoading />;
  }

  return (
    <div className="space-y-4">
      <section className="px-1">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dashboard</h2>
        <p className="mt-1 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
          Quick summary of your tasks, missions, and OKR performance.
        </p>
      </section>

      {loadError ? (
        <section className="surface-card rounded-[28px] px-5 py-5 sm:px-6" role="alert">
          <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
          <button type="button" onClick={() => void loadDashboard()} className="button-secondary mt-4 rounded-full px-4 py-2 text-sm font-medium">
            Retry
          </button>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-3">
        <article className="surface-card rounded-[28px] px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Tasks</p>
            <ListTodo className="h-5 w-5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          </div>
          <p className="mt-4 text-3xl font-semibold">{totalTasks}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {todoTasks} to do, {doneTasks} done
          </p>
          <Link href="/tasks" className="button-secondary mt-5 inline-flex rounded-full px-4 py-2 text-sm font-medium">
            Open tasks
          </Link>
        </article>

        <article className="surface-card rounded-[28px] px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Missions</p>
            <BriefcaseBusiness className="h-5 w-5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          </div>
          <p className="mt-4 text-3xl font-semibold">{missions.length}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {nextStepsCount} with a next step
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {totalMissionSteps} total steps
          </p>
          <Link href="/missions" className="button-secondary mt-5 inline-flex rounded-full px-4 py-2 text-sm font-medium">
            Open missions
          </Link>
        </article>

        <article className="surface-card rounded-[28px] px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">OKRs</p>
            <Target className="h-5 w-5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
          </div>
          <p className="mt-4 text-3xl font-semibold">{okrs.length}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {activeOkrs.length} active, {archivedOkrs.length} archived
          </p>
          <Link href="/okrs" className="button-secondary mt-5 inline-flex rounded-full px-4 py-2 text-sm font-medium">
            Open OKRs
          </Link>
        </article>
      </section>

      <section className="surface-card rounded-[28px] px-5 py-5 sm:px-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">OKR report</h3>
          <TrendingUp className="h-5 w-5" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="surface-subtle rounded-2xl px-4 py-3">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
              Avg progress
            </p>
            <p className="mt-2 text-2xl font-semibold">{Math.round(averageOkrProgress)}%</p>
          </div>
          <div className="surface-subtle rounded-2xl px-4 py-3">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
              Healthy KRs
            </p>
            <p className="mt-2 text-2xl font-semibold">{Math.round(healthyRate)}%</p>
          </div>
          <div className="surface-subtle rounded-2xl px-4 py-3">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
              Ending in 7 days
            </p>
            <p className="mt-2 text-2xl font-semibold">{endingSoonCount}</p>
          </div>
          <div className="surface-subtle rounded-2xl px-4 py-3">
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
              Overdue active OKRs
            </p>
            <p className="mt-2 text-2xl font-semibold">{overdueCount}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--success-tint) 74%, transparent)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--success)" }}>Ahead</p>
            <p className="mt-1 text-lg font-semibold">{healthCounts.ahead}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--accent-tint) 74%, transparent)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--accent)" }}>On track</p>
            <p className="mt-1 text-lg font-semibold">{healthCounts.on_track}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--background-subtle) 88%, transparent)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Off track</p>
            <p className="mt-1 text-lg font-semibold">{healthCounts.off_track}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--danger-tint) 72%, transparent)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>Critical</p>
            <p className="mt-1 text-lg font-semibold">{healthCounts.critical}</p>
          </div>
        </div>

        {totalRatedKeyResults === 0 ? (
          <p className="mt-4 text-sm" style={{ color: "var(--foreground-muted)" }}>
            Add key results to start seeing OKR health reporting.
          </p>
        ) : (
          <p className="mt-4 text-sm" style={{ color: "var(--foreground-muted)" }}>
            {activeKeyResults.length} active key results are being tracked across {activeOkrs.length} active objectives.
          </p>
        )}
      </section>

      {isLoading ? (
        <div className="flex items-center gap-2 px-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Refreshing dashboard...
        </div>
      ) : null}
    </div>
  );
}
