"use client";

type ToastItem = {
  id: number;
  type: "success" | "error";
  message: string;
};

type ToastStackProps = {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
};

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
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
              onClick={() => onDismiss(toast.id)}
              className="rounded-full px-2 py-1 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
