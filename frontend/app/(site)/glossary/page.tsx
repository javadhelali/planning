"use client";

import {
  BookOpenText,
  Ellipsis,
  PencilLine,
  Plus,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { del, get, post, put } from "../../utilities/api";
import Modal from "@/components/site/modal";

type AuthState = "checking" | "authenticated" | "guest";

type GlossaryLabel = {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type GlossaryTermLabel = {
  id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type GlossaryTerm = {
  id: number;
  user_id: number;
  term: string;
  short_definition: string;
  simple_definition: string;
  professional_definition: string;
  related_sources: string | null;
  note: string | null;
  related_terms: string[];
  labels: GlossaryTermLabel[];
  created_at: string;
  updated_at: string;
};

type GlossarySnapshot = {
  labels: GlossaryLabel[];
  terms: GlossaryTerm[];
};

type TermEditorState =
  | { mode: "create" }
  | { mode: "edit"; term: GlossaryTerm }
  | null;

type LabelEditorState =
  | { mode: "create" }
  | { mode: "edit"; label: GlossaryLabel }
  | null;

type PendingConfirmation =
  | { kind: "term"; term: GlossaryTerm }
  | { kind: "label"; label: GlossaryLabel }
  | null;

type ToastMessage = {
  id: number;
  type: "success" | "error";
  message: string;
};

const SESSION_COOKIE_KEY = "planning_session";

const LABEL_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
];

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

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return "#64748b";
}

function hexToRgb(hex: string) {
  const clean = normalizeHexColor(hex).slice(1);
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return { red, green, blue };
}

function colorSurfaceStyle(hex: string, alpha = 0.14) {
  const { red, green, blue } = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function markdownComponents(size: "sm" | "xs" = "sm") {
  const paragraphClass = size === "xs" ? "mb-2 last:mb-0 text-xs" : "mb-3 last:mb-0 text-sm";
  const listClass = size === "xs" ? "mb-2 pl-4 text-xs" : "mb-3 pl-5 text-sm";
  const headingClass = size === "xs" ? "mb-2 mt-3 text-xs font-semibold" : "mb-2 mt-3 text-sm font-semibold";

  return {
    p: ({ children }: { children?: ReactNode }) => (
      <p className={paragraphClass} style={{ color: "var(--foreground-muted)" }}>
        {children}
      </p>
    ),
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className={`${listClass} list-disc`} style={{ color: "var(--foreground-muted)" }}>
        {children}
      </ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className={`${listClass} list-decimal`} style={{ color: "var(--foreground-muted)" }}>
        {children}
      </ol>
    ),
    li: ({ children }: { children?: ReactNode }) => <li className="mb-1">{children}</li>,
    h1: ({ children }: { children?: ReactNode }) => <h4 className={headingClass}>{children}</h4>,
    h2: ({ children }: { children?: ReactNode }) => <h4 className={headingClass}>{children}</h4>,
    h3: ({ children }: { children?: ReactNode }) => <h4 className={headingClass}>{children}</h4>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
        {children}
      </a>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <div className="mb-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead
        style={{
          backgroundColor: "color-mix(in srgb, var(--background-elevated) 90%, transparent)",
          color: "var(--foreground)",
        }}
      >
        {children}
      </thead>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th
        className="px-2 py-1.5 font-semibold"
        style={{ border: "1px solid color-mix(in srgb, var(--card-border) 72%, transparent)" }}
      >
        {children}
      </th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td
        className="px-2 py-1.5 align-top"
        style={{ border: "1px solid color-mix(in srgb, var(--card-border) 72%, transparent)", color: "var(--foreground-muted)" }}
      >
        {children}
      </td>
    ),
  };
}

function MarkdownBlock({ value, size = "sm" }: { value: string; size?: "sm" | "xs" }) {
  return (
    <div className="whitespace-pre-wrap leading-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(size)}>
        {value}
      </ReactMarkdown>
    </div>
  );
}

function LabelBadge({ label }: { label: GlossaryTermLabel | GlossaryLabel }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        backgroundColor: colorSurfaceStyle(label.color, 0.2),
        color: label.color,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
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

function GuestGlossary() {
  return (
    <div className="content-width mx-auto px-4 py-10 sm:px-6 sm:py-14">
      <main className="surface-card rounded-[32px] px-6 py-8 sm:px-8 sm:py-10">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Build your personal business glossary</h1>
        <p className="mt-4 max-w-3xl text-base leading-7" style={{ color: "var(--foreground-muted)" }}>
          Capture strategy and startup terms, define them your way, and organize entries with labels.
        </p>
        <div className="mt-8">
          <Link href="/login" className="button-primary inline-flex rounded-full px-5 py-3 text-sm font-semibold">
            Sign in to start
          </Link>
        </div>
      </main>
    </div>
  );
}

function GlossaryLoadingState() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-10 w-52 rounded-xl" />
      <div className="skeleton h-20 rounded-[28px]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="skeleton h-28 rounded-[24px]" />
        ))}
      </div>
    </div>
  );
}

export default function GlossaryPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [labels, setLabels] = useState<GlossaryLabel[]>([]);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabelId, setSelectedLabelId] = useState<number | "all">("all");

  const [termViewer, setTermViewer] = useState<GlossaryTerm | null>(null);
  const [termEditor, setTermEditor] = useState<TermEditorState>(null);
  const [termValue, setTermValue] = useState("");
  const [shortDefinition, setShortDefinition] = useState("");
  const [simpleDefinition, setSimpleDefinition] = useState("");
  const [professionalDefinition, setProfessionalDefinition] = useState("");
  const [relatedSources, setRelatedSources] = useState("");
  const [noteValue, setNoteValue] = useState("");
  const [relatedTermsInput, setRelatedTermsInput] = useState("");
  const [selectedTermLabelIds, setSelectedTermLabelIds] = useState<number[]>([]);
  const [isTermSubmitting, setIsTermSubmitting] = useState(false);

  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [labelEditor, setLabelEditor] = useState<LabelEditorState>(null);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[0]);
  const [isLabelSubmitting, setIsLabelSubmitting] = useState(false);

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
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

  const loadGlossary = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get("/planning/glossary");
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const snapshot = (await response.json()) as GlossarySnapshot;
      setLabels(snapshot.labels);
      setTerms(snapshot.terms);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to load glossary");
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    setAuthState(hasSessionCookie() ? "authenticated" : "guest");
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void loadGlossary();
  }, [authState, loadGlossary]);

  const labelUsageMap = useMemo(() => {
    const usage = new Map<number, number>();
    terms.forEach((term) => {
      term.labels.forEach((label) => {
        usage.set(label.id, (usage.get(label.id) ?? 0) + 1);
      });
    });
    return usage;
  }, [terms]);

  const filteredTerms = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return terms.filter((term) => {
      if (selectedLabelId !== "all" && !term.labels.some((label) => label.id === selectedLabelId)) {
        return false;
      }

      if (!normalizedQuery) return true;

      const haystack = [
        term.term,
        term.short_definition,
        term.simple_definition,
        term.professional_definition,
        term.related_sources ?? "",
        term.note ?? "",
        term.related_terms.join(" "),
        term.labels.map((label) => label.name).join(" "),
      ]
        .join("\n")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [searchQuery, selectedLabelId, terms]);

  const openCreateTermModal = useCallback(() => {
    setTermViewer(null);
    setOpenMenuKey(null);
    setTermEditor({ mode: "create" });
    setTermValue("");
    setShortDefinition("");
    setSimpleDefinition("");
    setProfessionalDefinition("");
    setRelatedSources("");
    setNoteValue("");
    setRelatedTermsInput("");
    setSelectedTermLabelIds([]);
  }, []);

  const openEditTermModal = useCallback((term: GlossaryTerm) => {
    setTermViewer(null);
    setOpenMenuKey(null);
    setTermEditor({ mode: "edit", term });
    setTermValue(term.term);
    setShortDefinition(term.short_definition);
    setSimpleDefinition(term.simple_definition);
    setProfessionalDefinition(term.professional_definition);
    setRelatedSources(term.related_sources ?? "");
    setNoteValue(term.note ?? "");
    setRelatedTermsInput(term.related_terms.join(", "));
    setSelectedTermLabelIds(term.labels.map((label) => label.id));
  }, []);

  const closeTermModal = useCallback(() => {
    if (isTermSubmitting) return;
    setTermEditor(null);
  }, [isTermSubmitting]);

  const openLabelManager = useCallback(() => {
    setOpenMenuKey(null);
    setIsLabelManagerOpen(true);
    setLabelEditor({ mode: "create" });
    setLabelName("");
    setLabelColor(LABEL_COLORS[0]);
  }, []);

  const closeLabelManager = useCallback(() => {
    if (isLabelSubmitting) return;
    setIsLabelManagerOpen(false);
    setLabelEditor(null);
  }, [isLabelSubmitting]);

  const startCreateLabel = useCallback(() => {
    setLabelEditor({ mode: "create" });
    setLabelName("");
    setLabelColor(LABEL_COLORS[0]);
  }, []);

  const startEditLabel = useCallback((label: GlossaryLabel) => {
    setOpenMenuKey(null);
    setLabelEditor({ mode: "edit", label });
    setLabelName(label.name);
    setLabelColor(normalizeHexColor(label.color));
  }, []);

  const toggleTermLabel = useCallback((labelId: number) => {
    setSelectedTermLabelIds((current) => {
      if (current.includes(labelId)) {
        return current.filter((value) => value !== labelId);
      }
      return [...current, labelId];
    });
  }, []);

  async function handleSubmitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termEditor) return;

    const cleanedTerm = termValue.trim();
    const cleanedShortDefinition = shortDefinition.trim();
    const cleanedSimpleDefinition = simpleDefinition.trim();
    const cleanedProfessionalDefinition = professionalDefinition.trim();

    if (!cleanedTerm || !cleanedShortDefinition || !cleanedSimpleDefinition || !cleanedProfessionalDefinition) {
      return;
    }

    const relatedTerms = relatedTermsInput
      .split(",")
      .map((termItem) => termItem.trim())
      .filter((termItem, index, allItems) => termItem.length > 0 && allItems.indexOf(termItem) === index);

    setIsTermSubmitting(true);
    setBusyActionKey("submit-term");

    try {
      const payload = {
        term: cleanedTerm,
        short_definition: cleanedShortDefinition,
        simple_definition: cleanedSimpleDefinition,
        professional_definition: cleanedProfessionalDefinition,
        related_sources: relatedSources.trim() ? relatedSources.trim() : null,
        note: noteValue.trim() ? noteValue.trim() : null,
        related_terms: relatedTerms,
        label_ids: selectedTermLabelIds,
      };

      const response =
        termEditor.mode === "create"
          ? await post("/planning/glossary/terms", payload)
          : await put(`/planning/glossary/terms/${termEditor.term.id}`, payload);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const savedTerm = (await response.json()) as GlossaryTerm;
      setTermEditor(null);
      setTermViewer(savedTerm);
      pushToast("success", termEditor.mode === "create" ? "Term added." : "Term updated.");
      await loadGlossary();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to save term");
    } finally {
      setIsTermSubmitting(false);
      setBusyActionKey(null);
    }
  }

  async function handleSubmitLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!labelEditor) return;

    const cleanedName = labelName.trim();
    const cleanedColor = normalizeHexColor(labelColor);
    if (!cleanedName) return;

    setIsLabelSubmitting(true);
    setBusyActionKey("submit-label");

    try {
      const payload = { name: cleanedName, color: cleanedColor };
      const response =
        labelEditor.mode === "create"
          ? await post("/planning/glossary/labels", payload)
          : await put(`/planning/glossary/labels/${labelEditor.label.id}`, payload);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      pushToast("success", labelEditor.mode === "create" ? "Label added." : "Label updated.");
      startCreateLabel();
      await loadGlossary();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to save label");
    } finally {
      setIsLabelSubmitting(false);
      setBusyActionKey(null);
    }
  }

  async function handleDeleteTerm(term: GlossaryTerm) {
    setBusyActionKey(`delete-term-${term.id}`);
    try {
      const response = await del(`/planning/glossary/terms/${term.id}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPendingConfirmation(null);
      setTermViewer((current) => (current?.id === term.id ? null : current));
      setTerms((current) => current.filter((item) => item.id !== term.id));
      pushToast("success", "Term removed.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove term");
    } finally {
      setBusyActionKey(null);
    }
  }

  async function handleDeleteLabel(label: GlossaryLabel) {
    setBusyActionKey(`delete-label-${label.id}`);
    try {
      const response = await del(`/planning/glossary/labels/${label.id}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setPendingConfirmation(null);
      setOpenMenuKey(null);
      pushToast("success", "Label removed.");
      if (selectedLabelId === label.id) {
        setSelectedLabelId("all");
      }
      await loadGlossary();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to remove label");
    } finally {
      setBusyActionKey(null);
    }
  }

  if (authState === "checking") {
    return <GlossaryLoadingState />;
  }

  if (authState === "guest") {
    return <GuestGlossary />;
  }

  return (
    <div className="space-y-4">
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

      <section className="px-1">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-4xl flex-1">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Glossary</h2>
            <p className="mt-1 text-sm leading-6 sm:text-base" style={{ color: "var(--foreground-muted)" }}>
              Keep clean term cards here, then open each card to view full details.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm" style={{ color: "var(--foreground-muted)" }}>
              <span className="inline-flex items-center gap-1.5">
                <BookOpenText className="h-3.5 w-3.5" aria-hidden="true" />
                {terms.length} terms
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Tags className="h-3.5 w-3.5" aria-hidden="true" />
                {labels.length} labels
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openLabelManager}
              className="button-secondary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Tags className="h-4 w-4" aria-hidden="true" />
              Manage labels
            </button>
            <button
              type="button"
              onClick={openCreateTermModal}
              className="button-primary inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add term
            </button>
          </div>
        </div>
      </section>

      <section className="surface-card rounded-[28px] px-4 py-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)]">
          <label className="field flex items-center gap-2 rounded-2xl px-3 py-3">
            <Search className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search terms and definitions..."
              className="w-full bg-transparent text-sm outline-none"
              aria-label="Search glossary"
            />
          </label>

          <select
            value={selectedLabelId}
            onChange={(event) =>
              setSelectedLabelId(event.target.value === "all" ? "all" : Number.parseInt(event.target.value, 10))
            }
            className="field rounded-2xl px-4 py-3 text-sm"
          >
            <option value="all">All labels</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3 px-1">
          <h3 className="text-lg font-semibold">Terms</h3>
          <span className="text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
            {filteredTerms.length} shown
          </span>
        </div>

        {isLoading ? (
          <GlossaryLoadingState />
        ) : filteredTerms.length === 0 ? (
          <div className="surface-card rounded-[28px] px-5 py-9 sm:px-6">
            <h4 className="text-lg font-semibold">No matching terms</h4>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              Add your first term or adjust filters to show more glossary entries.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {filteredTerms.map((term) => (
              <li key={term.id}>
                <button
                  type="button"
                  onClick={() => setTermViewer(term)}
                  className="surface-subtle group flex h-28 w-full flex-col justify-between rounded-[22px] px-4 py-3 text-left transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                      {term.labels.length === 0 ? (
                        <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                          Unlabeled
                        </span>
                      ) : (
                        <>
                          {term.labels.slice(0, 1).map((label) => (
                            <LabelBadge key={`${term.id}-label-${label.id}`} label={label} />
                          ))}
                          {term.labels.length > 1 ? (
                            <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                              +{term.labels.length - 1}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          term.labels.length > 0
                            ? term.labels[0].color
                            : "color-mix(in srgb, var(--card-border) 72%, transparent)",
                      }}
                    />
                  </div>
                  <p className="line-clamp-2 text-sm font-semibold leading-6 sm:text-base">{term.term}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        isOpen={termViewer !== null}
        onClose={() => setTermViewer(null)}
        title={termViewer?.term ?? "Term"}
        description="Glossary entry details"
      >
        {termViewer ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {termViewer.labels.length > 0 ? (
                  termViewer.labels.map((label) => <LabelBadge key={`viewer-label-${label.id}`} label={label} />)
                ) : (
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    No labels
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Updated {new Date(termViewer.updated_at).toLocaleDateString()}
              </span>
            </div>

            <div className="rounded-[20px] border px-3 py-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                Short Definition
              </p>
              <p className="mt-2 text-sm leading-6">{termViewer.short_definition}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                Simple Definition (5-year-old)
              </p>
              <div className="mt-2 rounded-[20px] border px-3 py-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}>
                <MarkdownBlock value={termViewer.simple_definition} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                Professional Definition
              </p>
              <div className="mt-2 rounded-[20px] border px-3 py-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}>
                <MarkdownBlock value={termViewer.professional_definition} />
              </div>
            </div>

            {termViewer.related_sources ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                  Related Sources
                </p>
                <div className="mt-2 rounded-[20px] border px-3 py-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}>
                  <MarkdownBlock value={termViewer.related_sources} />
                </div>
              </div>
            ) : null}

            {termViewer.note ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                  Personal Notes
                </p>
                <div className="mt-2 rounded-[20px] border px-3 py-3" style={{ borderColor: "color-mix(in srgb, var(--card-border) 72%, transparent)" }}>
                  <MarkdownBlock value={termViewer.note} />
                </div>
              </div>
            ) : null}

            {termViewer.related_terms.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--foreground-muted)" }}>
                  Related Terms
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {termViewer.related_terms.map((relatedTerm) => (
                    <span
                      key={`${termViewer.id}-${relatedTerm}`}
                      className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--accent-tint) 72%, transparent)",
                        color: "var(--accent)",
                      }}
                    >
                      {relatedTerm}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => openEditTermModal(termViewer)}
                className="button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setPendingConfirmation({ kind: "term", term: termViewer })}
                className="button-danger inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={termEditor !== null}
        onClose={closeTermModal}
        title={termEditor?.mode === "create" ? "Add glossary term" : "Edit glossary term"}
        description="Define the term for different depth levels and attach one or more labels."
      >
        <form onSubmit={handleSubmitTerm} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="term-value" className="text-sm font-semibold">
                Term
              </label>
              <input
                id="term-value"
                value={termValue}
                onChange={(event) => setTermValue(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="Example: Product-Market Fit"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="short-definition" className="text-sm font-semibold">
                Short definition
              </label>
              <input
                id="short-definition"
                value={shortDefinition}
                onChange={(event) => setShortDefinition(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="Single-line, clear summary."
                required
              />
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm font-semibold">Labels</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {labels.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                    No labels yet. Create labels from Manage labels.
                  </p>
                ) : (
                  labels.map((label) => {
                    const active = selectedTermLabelIds.includes(label.id);
                    return (
                      <button
                        key={`term-editor-label-${label.id}`}
                        type="button"
                        onClick={() => toggleTermLabel(label.id)}
                        className="rounded-full border px-3 py-1 text-xs font-medium transition"
                        style={{
                          borderColor: active
                            ? label.color
                            : "color-mix(in srgb, var(--card-border) 72%, transparent)",
                          backgroundColor: active
                            ? colorSurfaceStyle(label.color, 0.22)
                            : "color-mix(in srgb, var(--background-elevated) 90%, transparent)",
                          color: active ? label.color : "var(--foreground-muted)",
                        }}
                      >
                        {label.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="related-terms-input" className="text-sm font-semibold">
                Related terms
              </label>
              <input
                id="related-terms-input"
                value={relatedTermsInput}
                onChange={(event) => setRelatedTermsInput(event.target.value)}
                className="field mt-2 rounded-2xl px-4 py-3 text-sm"
                placeholder="Comma separated (e.g. CAC, LTV)"
              />
            </div>
          </div>

          <div>
            <label htmlFor="simple-definition" className="text-sm font-semibold">
              Simple definition (5-year-old)
            </label>
            <textarea
              id="simple-definition"
              value={simpleDefinition}
              onChange={(event) => setSimpleDefinition(event.target.value)}
              className="field mt-2 min-h-28 rounded-2xl px-4 py-3 text-sm"
              placeholder="Markdown supported."
              required
            />
          </div>

          <div>
            <label htmlFor="professional-definition" className="text-sm font-semibold">
              Professional definition
            </label>
            <textarea
              id="professional-definition"
              value={professionalDefinition}
              onChange={(event) => setProfessionalDefinition(event.target.value)}
              className="field mt-2 min-h-32 rounded-2xl px-4 py-3 text-sm"
              placeholder="Markdown supported."
              required
            />
          </div>

          <div>
            <label htmlFor="related-sources" className="text-sm font-semibold">
              Related sources
            </label>
            <textarea
              id="related-sources"
              value={relatedSources}
              onChange={(event) => setRelatedSources(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
              placeholder="Markdown supported."
            />
          </div>

          <div>
            <label htmlFor="note-value" className="text-sm font-semibold">
              Notes
            </label>
            <textarea
              id="note-value"
              value={noteValue}
              onChange={(event) => setNoteValue(event.target.value)}
              className="field mt-2 min-h-24 rounded-2xl px-4 py-3 text-sm"
              placeholder="Why this term matters to you, usage context, reminders. Markdown supported."
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeTermModal}
              disabled={isTermSubmitting}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTermSubmitting}
              className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {isTermSubmitting ? "Saving..." : termEditor?.mode === "create" ? "Create term" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isLabelManagerOpen}
        onClose={closeLabelManager}
        title="Manage labels"
        description="Create, edit, and color-code labels used by glossary terms."
      >
        <div className="space-y-5">
          <form onSubmit={handleSubmitLabel} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={labelName}
                onChange={(event) => setLabelName(event.target.value)}
                className="field rounded-2xl px-4 py-3 text-sm"
                placeholder="Label name"
                required
              />
              <input
                type="color"
                value={labelColor}
                onChange={(event) => setLabelColor(normalizeHexColor(event.target.value))}
                className="field h-12 w-16 rounded-2xl px-1.5 py-1.5"
                aria-label="Label color"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {LABEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setLabelColor(color)}
                  className="h-7 w-7 rounded-full border"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      labelColor === color
                        ? "color-mix(in srgb, var(--foreground) 40%, transparent)"
                        : "color-mix(in srgb, var(--card-border) 72%, transparent)",
                  }}
                  title={color}
                  aria-label={`Pick ${color}`}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {labelEditor?.mode === "edit" ? (
                <button
                  type="button"
                  onClick={startCreateLabel}
                  className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
                >
                  New label
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isLabelSubmitting}
                className="button-primary rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                {isLabelSubmitting
                  ? "Saving..."
                  : labelEditor?.mode === "edit"
                    ? "Save label"
                    : "Create label"}
              </button>
            </div>
          </form>

          {labels.length === 0 ? (
            <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
              No labels yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {labels.map((label) => (
                <li
                  key={label.id}
                  className="surface-subtle rounded-2xl px-3 py-2.5"
                  style={{ borderLeft: `4px solid ${label.color}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label.name}</p>
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                        {labelUsageMap.get(label.id) ?? 0} terms
                      </p>
                    </div>
                    <ActionMenu
                      menuKey={`label-${label.id}`}
                      openMenuKey={openMenuKey}
                      onToggle={(menuKey) => setOpenMenuKey((current) => (current === menuKey ? null : menuKey))}
                    >
                      <ActionMenuItem onClick={() => startEditLabel(label)}>
                        <span className="inline-flex items-center gap-2">
                          <PencilLine className="h-4 w-4" aria-hidden="true" />
                          Edit label
                        </span>
                      </ActionMenuItem>
                      <ActionMenuItem
                        tone="danger"
                        onClick={() => {
                          setOpenMenuKey(null);
                          setPendingConfirmation({ kind: "label", label });
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Delete label
                        </span>
                      </ActionMenuItem>
                    </ActionMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={pendingConfirmation !== null}
        onClose={() => {
          if (busyActionKey?.startsWith("delete-")) return;
          setPendingConfirmation(null);
        }}
        title={pendingConfirmation?.kind === "label" ? "Delete label?" : "Delete term?"}
        description={
          pendingConfirmation?.kind === "label"
            ? "Terms with this label will remain and simply lose this label."
            : "This removes this term from your glossary."
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--foreground-muted)" }}>
            {pendingConfirmation?.kind === "label"
              ? `Delete "${pendingConfirmation.label.name}"?`
              : pendingConfirmation?.kind === "term"
                ? `Delete "${pendingConfirmation.term.term}"?`
                : ""}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingConfirmation(null)}
              disabled={Boolean(busyActionKey?.startsWith("delete-"))}
              className="button-secondary rounded-2xl px-4 py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                pendingConfirmation?.kind === "label"
                  ? void handleDeleteLabel(pendingConfirmation.label)
                  : pendingConfirmation?.kind === "term"
                    ? void handleDeleteTerm(pendingConfirmation.term)
                    : undefined
              }
              disabled={Boolean(busyActionKey?.startsWith("delete-"))}
              className="button-danger rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              {busyActionKey?.startsWith("delete-") ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
