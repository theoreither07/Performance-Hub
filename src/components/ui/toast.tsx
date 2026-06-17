"use client";

/**
 * Schlanker Toast-Provider (kein @radix-ui/react-toast — minimaler eigener Code).
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast.success("Gespeichert");
 *   toast.error("Fehlgeschlagen", "Server antwortete nicht");
 *
 * Toasts erscheinen bottom-right, auto-dismiss nach 4 Sek, manuell schliessbar.
 */
import * as React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ToastVariant = "success" | "error" | "info";
interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  show: (variant: ToastVariant, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const remove = React.useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      const id = `${variant}-${performance.now()}-${Math.floor(Math.random() * 1000)}`;
      setToasts((cur) => [...cur, { id, variant, title, description }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      show,
      success: (t, d) => show("success", t, d),
      error: (t, d) => show("error", t, d),
      info: (t, d) => show("info", t, d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = toast.variant === "success" ? CheckCircle2 : toast.variant === "error" ? AlertCircle : Info;
  const variantCls =
    toast.variant === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : toast.variant === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-100"
      : "border-blue-500/40 bg-blue-500/10 text-blue-100";

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto rounded-lg border px-3 py-2.5 backdrop-blur-md shadow-lg flex items-start gap-2.5",
        "animate-in slide-in-from-right-4 fade-in duration-200",
        variantCls,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium leading-tight">{toast.title}</p>
        {toast.description && <p className="text-xs opacity-80 leading-snug">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Schliessen"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
