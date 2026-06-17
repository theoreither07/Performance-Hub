#!/usr/bin/env node
/**
 * Personal Dashboard — MCP Server
 *
 * Stellt Tools fuer Claude Desktop bereit, die Todos/Projekte/Kalender/Health
 * lesen und schreiben.
 *
 * Erwartet die Env-Vars:
 *   DASHBOARD_URL = https://your-dashboard.example.com  (oder http://localhost:3000 lokal)
 *   DASHBOARD_MCP_TOKEN = das in der Dashboard-Env gesetzte MCP_API_TOKEN
 *
 * Konfiguration in Claude Desktop ~/Library/Application Support/Claude/claude_desktop_config.json:
 *
 * {
 *   "mcpServers": {
 *     "dashboard": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server/dist/index.js"],
 *       "env": {
 *         "DASHBOARD_URL": "https://your-dashboard.example.com",
 *         "DASHBOARD_MCP_TOKEN": "..."
 *       }
 *     }
 *   }
 * }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const TOKEN = process.env.DASHBOARD_MCP_TOKEN ?? "";

if (!TOKEN) {
  console.error("DASHBOARD_MCP_TOKEN ist nicht gesetzt — Server wird nicht starten");
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const server = new Server(
  {
    name: "dashboard",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const TOOLS = [
  {
    name: "list_todos",
    description: "Listet ToDos. status: 'open' (offen+wartet+in_progress, Default), 'done', 'all'. area optional: PRIVATE|FH|BUSINESS.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "all"] },
        area: { type: "string", enum: ["PRIVATE", "FH", "BUSINESS"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "create_todo",
    description: "Legt ein neues ToDo an. Mindestens title und area noetig.",
    inputSchema: {
      type: "object",
      required: ["title", "area"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        area: { type: "string", enum: ["PRIVATE", "FH", "BUSINESS"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "WAITING", "DONE"] },
        dueDate: { type: "string", description: "ISO datetime, z.B. 2026-05-16T18:00:00" },
        estimatedMinutes: { type: "integer", minimum: 1 },
        projectId: { type: "string" },
      },
    },
  },
  {
    name: "update_todo",
    description: "Aktualisiert ein bestehendes ToDo (mark as done, change project, etc.).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        area: { type: "string", enum: ["PRIVATE", "FH", "BUSINESS"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"] },
        dueDate: { type: ["string", "null"] },
        estimatedMinutes: { type: ["integer", "null"], minimum: 1 },
        projectId: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "list_projects",
    description: "Listet alle Projekte mit Kontaktdaten und Anzahl Tasks.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_project",
    description: "Legt ein neues Projekt an.",
    inputSchema: {
      type: "object",
      required: ["name", "area"],
      properties: {
        name: { type: "string" },
        area: { type: "string", enum: ["PRIVATE", "FH", "BUSINESS"] },
        description: { type: "string" },
        contactName: { type: "string" },
        contactEmail: { type: "string" },
        contactPhone: { type: "string" },
        color: { type: "string", description: "Hex color z.B. #AAFF00" },
      },
    },
  },
  {
    name: "get_calendar",
    description: "Termine ab heute, default 1 Tag (heute), max 31 Tage. Enthaelt Privat+Business.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 31 },
      },
    },
  },
  {
    name: "get_health",
    description: "Gibt Health-Metrik-Summary der letzten N Tage (default 14): latest + 7-Tage-Average pro Kategorie (HRV, Schlaf, Body Battery, etc.) plus volle Zeitreihe.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 180 },
      },
    },
  },
  {
    name: "get_mail",
    description: "Liest Mails aus den verbundenen Gmail-Konten. account=PRIVATE|BUSINESS oder beide. query ist eine Gmail-Search-Query (default 'is:unread in:inbox'; Beispiele: 'is:starred', 'from:max@x.de', 'after:2026/05/01', 'subject:rechnung'). summary=true gibt nur Ungelesen-Counts.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", enum: ["PRIVATE", "BUSINESS"] },
        query: { type: "string" },
        max: { type: "integer", minimum: 1, maximum: 50 },
        summary: { type: "boolean" },
      },
    },
  },
  {
    name: "list_habits",
    description: "Listet alle aktiven Habits mit doneToday-Flag, aktuellem Streak und Completion-Rate der letzten 30 Tage.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_habit",
    description: "Legt einen neuen Habit an (Routine, die du regelmaessig machen willst).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        color: { type: "string", description: "Hex z.B. #AAFF00" },
        targetPerWeek: { type: "integer", minimum: 1, maximum: 7 },
      },
    },
  },
  {
    name: "check_habit",
    description: "Markiert einen Habit fuer ein Datum als erledigt (done:true) oder unerledigt (done:false). Default-Datum: heute.",
    inputSchema: {
      type: "object",
      required: ["id", "done"],
      properties: {
        id: { type: "string", description: "Habit-ID" },
        done: { type: "boolean" },
        date: { type: "string", description: "ISO-Datum, default heute" },
        note: { type: "string" },
      },
    },
  },
  {
    name: "daily_briefing",
    description: "DAS Tool fuer den Daily Coach. Liefert in EINEM Call: heutige Termine (Privat+Business), offene Top-Priority Todos + ueberfaellige, Health-Highlights (HRV, Schlaf, Body Battery, Readiness, RHR, Stress, Schritte), Habits-Status heute, Wetter Wien, Tagesweisheit, ungelesene Mails-Sample. Mit days>1 erweitert auf naechste N Tage.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 7, description: "Tage in die Zukunft, default 1 = nur heute" },
      },
    },
  },
  {
    name: "weekly_report",
    description: "Wochenrueckblick + naechste Woche. Was wurde erledigt (Todos), wie ist die Health-Trend-Entwicklung (last7 vs prev7), Habit-Completion-Rate, Kalenderdichte naechste Woche, Deadlines naechste 14 Tage. Ideal fuer Sonntag-Review + Wochenplanung.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_training_status",
    description: "DAS Tool fuer den KI-Trainer: Day-Score (0-100), Recovery-Status (green/yellow/red), ACWR (Acute:Chronic Workload Ratio), konkrete Trainings-Empfehlung pro Tag + Workouts der letzten 14 Tage + Journal-Eintraege (Stimmung/Energie/Soreness etc). Use this BEFORE proposing workouts.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 14, description: "Anzahl Tage rueckwaerts, default 7" },
      },
    },
  },
  {
    name: "log_journal",
    description: "Speichert subjektives Tages-Feedback (Mood, Energy, Motivation, Soreness, SleepQuality, WorkoutFelt — je 1-10). Idempotent pro Tag, ueberschreibt bei gleichem Datum. Default Datum: heute.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO-Date, default heute" },
        mood: { type: ["integer", "null"], minimum: 1, maximum: 10 },
        energy: { type: ["integer", "null"], minimum: 1, maximum: 10 },
        motivation: { type: ["integer", "null"], minimum: 1, maximum: 10 },
        soreness: { type: ["integer", "null"], minimum: 1, maximum: 10, description: "10 = stark verspannt" },
        workoutFelt: { type: ["integer", "null"], minimum: 1, maximum: 10, description: "Wie sich das heutige Workout angefuehlt hat" },
        sleepQuality: { type: ["integer", "null"], minimum: 1, maximum: 10 },
        ateWell: { type: ["boolean", "null"] },
        alcoholDrinks: { type: ["integer", "null"], minimum: 0, maximum: 30 },
        notes: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "list_workouts",
    description: "Listet die Workouts der letzten N Tage (default 30). Mix aus Garmin-synced + manuell eingetragenen.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 180 },
      },
    },
  },
  {
    name: "coach_review",
    description: "Tiefer Wochenend-Review fuer den KI-Coach. Liefert: Workouts der letzten N Tage (mit RPE/Feeling/Notes), Journal-Eintraege (Mood/Energy/Soreness/Sleep + Ernaehrung+Alkohol), Health-Trends current vs previous period, TrainingProfile (Ziele+Wochenplan), 30d Aggregate pro Trainings-Type. Use this fuer Sonntags-Rueckblick + Wochenplanung.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 60, description: "Aktueller Review-Zeitraum (default 7)" },
        longDays: { type: "integer", minimum: 7, maximum: 180, description: "Langer Vergleichszeitraum fuer Fortschrittsanalyse (default 30)" },
      },
    },
  },
  {
    name: "log_workout",
    description: "Manuelles Workout eintragen (z.B. wenn du etwas ohne Garmin gemacht hast). type: running|cycling|strength|yoga|swimming|hiking|rowing|other.",
    inputSchema: {
      type: "object",
      required: ["date", "type", "durationSec"],
      properties: {
        date: { type: "string", description: "ISO-Date, z.B. 2026-05-14" },
        startTime: { type: "string", description: "Optional ISO-DateTime mit Uhrzeit" },
        type: { type: "string", enum: ["running", "cycling", "strength", "yoga", "swimming", "hiking", "rowing", "other"] },
        name: { type: "string" },
        durationSec: { type: "integer", minimum: 60, description: "Dauer in Sekunden" },
        distanceM: { type: "number", description: "Distanz in Meter" },
        calories: { type: "number" },
        avgHr: { type: "number", description: "Avg HR in bpm" },
        maxHr: { type: "number" },
        notes: { type: "string" },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result: unknown;
    if (name === "list_todos") {
      const q = new URLSearchParams();
      if (args.status) q.set("status", String(args.status));
      if (args.area) q.set("area", String(args.area));
      if (args.limit) q.set("limit", String(args.limit));
      result = await api("GET", `/api/mcp/todos?${q}`);
    } else if (name === "create_todo") {
      result = await api("POST", "/api/mcp/todos", args);
    } else if (name === "update_todo") {
      const { id, ...rest } = args as { id: string; [k: string]: unknown };
      result = await api("PATCH", `/api/mcp/todos/${id}`, rest);
    } else if (name === "list_projects") {
      result = await api("GET", "/api/mcp/projects");
    } else if (name === "create_project") {
      result = await api("POST", "/api/mcp/projects", args);
    } else if (name === "get_calendar") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      result = await api("GET", `/api/mcp/calendar?${q}`);
    } else if (name === "get_health") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      result = await api("GET", `/api/mcp/health?${q}`);
    } else if (name === "get_mail") {
      const q = new URLSearchParams();
      if (args.account) q.set("account", String(args.account));
      if (args.query) q.set("query", String(args.query));
      if (args.max) q.set("max", String(args.max));
      if (args.summary) q.set("summary", "1");
      result = await api("GET", `/api/mcp/mail?${q}`);
    } else if (name === "list_habits") {
      result = await api("GET", "/api/mcp/habits");
    } else if (name === "create_habit") {
      result = await api("POST", "/api/mcp/habits", args);
    } else if (name === "check_habit") {
      const { id, ...rest } = args as { id: string; [k: string]: unknown };
      result = await api("POST", `/api/mcp/habits/${id}/check`, rest);
    } else if (name === "daily_briefing") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      result = await api("GET", `/api/mcp/briefing?${q}`);
    } else if (name === "weekly_report") {
      result = await api("GET", "/api/mcp/weekly-report");
    } else if (name === "get_training_status") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      result = await api("GET", `/api/mcp/training-status?${q}`);
    } else if (name === "log_journal") {
      result = await api("POST", "/api/mcp/journal", args);
    } else if (name === "list_workouts") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      result = await api("GET", `/api/mcp/workouts?${q}`);
    } else if (name === "log_workout") {
      result = await api("POST", "/api/mcp/workouts", args);
    } else if (name === "coach_review") {
      const q = new URLSearchParams();
      if (args.days) q.set("days", String(args.days));
      if (args.longDays) q.set("longDays", String(args.longDays));
      result = await api("GET", `/api/mcp/coach-review?${q}`);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[dashboard-mcp] connected via stdio");
