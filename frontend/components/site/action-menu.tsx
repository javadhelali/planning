"use client";

import { Ellipsis } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

type ActionMenuButtonProps = {
  title: string;
  isOpen: boolean;
  onClick: () => void;
};

type ActionMenuItemProps = {
  children: ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

type ActionMenuProps = {
  menuKey: string;
  openMenuKey: string | null;
  onToggle: (menuKey: string) => void;
  children: ReactNode;
  adaptiveDirection?: boolean;
  className?: string;
};

export function ActionMenuButton({ title, isOpen, onClick }: ActionMenuButtonProps) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
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

export function ActionMenuItem({ children, onClick, tone = "default", disabled = false }: ActionMenuItemProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
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

export function ActionMenu({
  menuKey,
  openMenuKey,
  onToggle,
  children,
  adaptiveDirection = false,
  className,
}: ActionMenuProps) {
  const isOpen = openMenuKey === menuKey;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openDirection, setOpenDirection] = useState<"down" | "up">("down");

  useEffect(() => {
    if (!isOpen || !adaptiveDirection) return;

    const frameId = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const container = root.closest(".app-scroll");
      const rootRect = root.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const viewportTop = container instanceof HTMLElement ? container.getBoundingClientRect().top : 0;
      const viewportBottom =
        container instanceof HTMLElement ? container.getBoundingClientRect().bottom : window.innerHeight;
      const spaceBelow = viewportBottom - rootRect.bottom;
      const spaceAbove = rootRect.top - viewportTop;

      if (spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow) {
        setOpenDirection("up");
        return;
      }

      setOpenDirection("down");
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [adaptiveDirection, isOpen]);

  return (
    <div ref={rootRef} data-action-menu-root data-open={isOpen ? "true" : undefined} className={`relative ${className ?? ""}`}>
      <ActionMenuButton title="Open actions" isOpen={isOpen} onClick={() => onToggle(menuKey)} />
      {isOpen ? (
        <div
          ref={menuRef}
          className={`surface-card absolute right-0 z-20 w-52 rounded-[24px] p-2 shadow-[var(--shadow-4)] ${
            openDirection === "up" ? "bottom-11" : "top-11"
          }`}
          style={{ border: "1px solid color-mix(in srgb, var(--card-border) 72%, transparent)" }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="space-y-1">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
