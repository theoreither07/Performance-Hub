import { db, type LocalTodo, type LocalProject, type OutboxEntry } from "@/lib/db/dexie";

// Sync-Engine: pusht alle dirty Entities + outbox-Eintraege zum Server,
// pullt anschliessend neue/veraenderte Daten seit lastPulledAt.
//
// Strategie:
// - CREATE: POST /api/sync/push mit clientId. Server antwortet mit echter ID + updatedAt.
// - UPDATE: PATCH mit id+updatedAt (Server entscheidet bei Konflikt = neueres updatedAt gewinnt).
// - DELETE: DELETE mit id. Lokal hart geloescht nach Server-OK.
// - PULL: GET /api/sync/pull?since=<iso> -> Diff seit letztem Pull, lokal mergen.

const META_LAST_PULL = "sync:lastPulledAt";
const MAX_ATTEMPTS = 5;

function nowIso() {
  return new Date().toISOString();
}

export async function getLastPulledAt(): Promise<string | null> {
  const row = await db.meta.get(META_LAST_PULL);
  return (row?.value as string | undefined) ?? null;
}

async function setLastPulledAt(iso: string) {
  await db.meta.put({ key: META_LAST_PULL, value: iso, updatedAt: nowIso() });
}

export async function enqueue(entry: Omit<OutboxEntry, "id" | "queuedAt" | "attempts">) {
  await db.outbox.add({ ...entry, queuedAt: nowIso(), attempts: 0 });
}

async function pushOutbox(): Promise<{ ok: number; failed: number }> {
  const entries = await db.outbox.orderBy("queuedAt").toArray();
  let ok = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.attempts >= MAX_ATTEMPTS) continue;
    try {
      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { id: string; updatedAt: string };
      // Bei CREATE: lokalen Datensatz von clientId -> serverId umschluesseln
      if (entry.operation === "CREATE" && entry.entity === "todo") {
        const local = await db.todos.where("clientId").equals(entry.entityClientId).first();
        if (local && local.id !== result.id) {
          await db.transaction("rw", db.todos, async () => {
            await db.todos.delete(local.id);
            await db.todos.put({
              ...local,
              id: result.id,
              updatedAt: result.updatedAt,
              _dirty: 0,
              _syncedAt: nowIso(),
            });
          });
        } else if (local) {
          await db.todos.update(local.id, { _dirty: 0, _syncedAt: nowIso() });
        }
      } else if (entry.operation === "UPDATE" && entry.entity === "todo") {
        await db.todos.where("clientId").equals(entry.entityClientId).modify({
          _dirty: 0,
          _syncedAt: nowIso(),
          updatedAt: result.updatedAt,
        });
      } else if (entry.operation === "DELETE" && entry.entity === "todo") {
        await db.todos.where("clientId").equals(entry.entityClientId).delete();
      }
      // Analog Project:
      if (entry.operation === "CREATE" && entry.entity === "project") {
        const local = await db.projects.where("clientId").equals(entry.entityClientId).first();
        if (local && local.id !== result.id) {
          await db.transaction("rw", db.projects, async () => {
            await db.projects.delete(local.id);
            await db.projects.put({ ...local, id: result.id, updatedAt: result.updatedAt, _dirty: 0, _syncedAt: nowIso() });
          });
        }
      } else if (entry.operation === "UPDATE" && entry.entity === "project") {
        await db.projects.where("clientId").equals(entry.entityClientId).modify({ _dirty: 0, _syncedAt: nowIso() });
      } else if (entry.operation === "DELETE" && entry.entity === "project") {
        await db.projects.where("clientId").equals(entry.entityClientId).delete();
      }
      await db.outbox.delete(entry.id!);
      ok++;
    } catch (err) {
      failed++;
      await db.outbox.update(entry.id!, {
        attempts: entry.attempts + 1,
        lastError: String(err),
      });
    }
  }
  return { ok, failed };
}

async function pull(): Promise<void> {
  const since = await getLastPulledAt();
  const res = await fetch(`/api/sync/pull?since=${encodeURIComponent(since ?? "")}`);
  if (!res.ok) throw new Error(`Pull HTTP ${res.status}`);
  const data = (await res.json()) as {
    serverTime: string;
    todos: LocalTodo[];
    projects: LocalProject[];
    deletedTodoIds: string[];
    deletedProjectIds: string[];
  };
  await db.transaction("rw", db.todos, db.projects, async () => {
    for (const t of data.todos) {
      const existing = await db.todos.get(t.id);
      // Last-Write-Wins: nur ueberschreiben, wenn Server neuer ODER lokal nicht dirty
      if (!existing || (!existing._dirty && new Date(t.updatedAt) > new Date(existing.updatedAt))) {
        await db.todos.put({ ...t, _dirty: 0, _deleted: 0, _syncedAt: nowIso() });
      }
    }
    for (const p of data.projects) {
      const existing = await db.projects.get(p.id);
      if (!existing || (!existing._dirty && new Date(p.updatedAt) > new Date(existing.updatedAt))) {
        await db.projects.put({ ...p, _dirty: 0, _deleted: 0, _syncedAt: nowIso() });
      }
    }
    for (const id of data.deletedTodoIds) await db.todos.delete(id);
    for (const id of data.deletedProjectIds) await db.projects.delete(id);
  });
  await setLastPulledAt(data.serverTime);
}

export async function syncNow(): Promise<{ pushed: number; pullOk: boolean }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { pushed: 0, pullOk: false };
  }
  const pushResult = await pushOutbox();
  let pullOk = true;
  try {
    await pull();
  } catch (err) {
    console.error("[sync] pull failed", err);
    pullOk = false;
  }
  return { pushed: pushResult.ok, pullOk };
}

export function startAutoSync(intervalMs = 30_000) {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await syncNow();
    } catch (err) {
      console.error("[sync] tick failed", err);
    }
  };
  // initial sofort
  void tick();
  const interval = setInterval(tick, intervalMs);
  const onOnline = () => void tick();
  window.addEventListener("online", onOnline);
  return () => {
    stopped = true;
    clearInterval(interval);
    window.removeEventListener("online", onOnline);
  };
}
