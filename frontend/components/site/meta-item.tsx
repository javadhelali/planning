import { ReactNode } from "react";

type MetaItemProps = {
  icon: ReactNode;
  children: ReactNode;
};

export default function MetaItem({ icon, children }: MetaItemProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ color: "var(--foreground-muted)" }}>{icon}</span>
      <span>{children}</span>
    </span>
  );
}
