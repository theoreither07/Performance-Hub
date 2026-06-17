"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, Send, Brain, Check, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format, parseISO } from "date-fns";

interface ChatAction {
  type: string;
  label: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[] | null;
  createdAt: string;
}

function renderInline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    parts.push(<strong key={key++} className="font-semibold">{m[0].slice(2, -2)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Brain className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", isUser ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted/60 rounded-bl-sm")}>
        {msg.content.split("\n").map((line, i) => (
          <p key={i} className={i > 0 ? "mt-1.5" : ""}>{renderInline(line)}</p>
        ))}
        {msg.actions && msg.actions.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
            {msg.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                <Check className="h-3 w-3 shrink-0" />
                {a.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-2 justify-start">
      <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Brain className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="bg-muted/60 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" />
      </div>
    </div>
  );
}

export function CoachChat() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ["coach-chat"],
    queryFn: async () => {
      const res = await fetch("/api/coach/chat");
      if (!res.ok) throw new Error("chat");
      return res.json();
    },
    staleTime: 10_000,
    enabled: open, // erst laden wenn geoeffnet
  });

  const send = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Chat-Fehler");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-chat"] }),
  });

  const clear = useMutation({
    mutationFn: async () => { await fetch("/api/coach/chat", { method: "DELETE" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-chat"] }),
  });

  const messages = data?.messages ?? [];
  const pendingUser = send.isPending ? send.variables : null;

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, send.isPending, open]);

  const submit = () => {
    const msg = input.trim();
    if (!msg || send.isPending) return;
    setInput("");
    send.mutate(msg);
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform safe-bottom"
          aria-label="Coach-Chat oeffnen"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat-Panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh] sm:max-h-[600px] h-[80vh] sm:h-[600px]">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">Coach-Chat</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Kennt deine letzten 14 Tage</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { if (confirm("Chat-Verlauf loeschen?")) clear.mutate(); }}
                    className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-muted/50"
                    aria-label="Verlauf loeschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  aria-label="Schliessen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && !pendingUser && (
                <div className="text-center py-6 space-y-3">
                  <Brain className="h-8 w-8 text-primary/50 mx-auto" />
                  <p className="text-sm text-muted-foreground">Frag deinen Coach oder gib ihm Kontext:</p>
                  <div className="flex flex-col gap-1.5 text-xs">
                    {[
                      "Warum ist mein Score heute so niedrig?",
                      "War am Wochenende feiern, daher wenig Schlaf — kein Uebertraining.",
                      "Wie soll ich den Long Run morgen angehen?",
                    ].map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setInput(ex)}
                        className="text-left px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => <Bubble key={m.id} msg={m} />)}
              {pendingUser && <Bubble msg={{ id: "p", role: "user", content: pendingUser, createdAt: "" }} />}
              {send.isPending && <TypingDots />}
              {send.error && (
                <p className="text-xs text-red-400 text-center">{send.error instanceof Error ? send.error.message : String(send.error)}</p>
              )}
            </div>

            {/* Input */}
            <div className="px-3 py-3 border-t border-border shrink-0 flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                placeholder="Nachricht..."
                rows={1}
                className="text-sm resize-none min-h-[40px] max-h-28"
              />
              <Button onClick={submit} disabled={!input.trim() || send.isPending} size="icon" className="shrink-0 h-10 w-10">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
