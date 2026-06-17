/**
 * Parser fuer Trainings-Termine aus Google Calendar.
 *
 * Erkennt Trainings am Kalendertitel-Praefix:
 *   - "Krafttraining: ..." oder "Kraft: ..." -> strength
 *   - "Cardio: Laufen 11km" / "Cardio: Lauf" / "Lauf:" / "Laufen:" -> running
 *   - "Cardio: Rad" / "Cycling:" / "Rad:" -> cycling
 *   - "Cardio: Wandern" / "Wandern:" / "Hiking:" -> hiking
 *   - "Cardio: Schwimmen" / "Schwimmen:" -> swimming
 *   - "Yoga:" / "Stretching:" / "Mobility:" -> yoga
 *   - "Cardio:" ohne erkennbare Sportart -> cardio (generic)
 *
 * Distanz wird aus dem Titel extrahiert ("11km", "11 km", "11,5km", "22 km").
 */

export type PlannedType =
  | "strength"
  | "running"
  | "cycling"
  | "hiking"
  | "swimming"
  | "yoga"
  | "rowing"
  | "cardio"
  | "other";

export interface PlannedTraining {
  type: PlannedType;
  name: string;        // "Oberkörper", "Laufen 11km", ...
  distanceKm?: number; // wenn im Titel angegeben
  rawTitle: string;
  start: string;       // ISO
  end: string;         // ISO
  allDay: boolean;
}

const STRENGTH_PREFIXES = ["krafttraining", "kraft", "strength", "gym"];
const RUNNING_KEYWORDS = ["lauf", "laufen", "run", "running", "jogging"];
const CYCLING_KEYWORDS = ["rad", "cycling", "bike", "biken"];
const HIKING_KEYWORDS = ["wander", "wandern", "hiking", "hike"];
const SWIMMING_KEYWORDS = ["schwimm", "swimming", "swim"];
const YOGA_KEYWORDS = ["yoga", "mobility", "stretch", "dehn"];
const ROWING_KEYWORDS = ["rudern", "rowing", "row"];

function extractDistanceKm(title: string): number | undefined {
  // "11km", "11 km", "11,5km", "11.5 km", "22km", "5km"
  const m = title.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (!m) return undefined;
  return parseFloat(m[1].replace(",", "."));
}

function trimAfterColon(s: string): string {
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1).trim() : s.trim();
}

export function parseTrainingFromTitle(title: string): Omit<PlannedTraining, "start" | "end" | "allDay" | "rawTitle"> | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  const distance = extractDistanceKm(title);

  for (const p of STRENGTH_PREFIXES) {
    if (lower.startsWith(p)) {
      return { type: "strength", name: trimAfterColon(title) || "Krafttraining", distanceKm: distance };
    }
  }

  // Cardio: ... — typ aus payload nach Doppelpunkt erraten
  if (lower.startsWith("cardio")) {
    const rest = trimAfterColon(title).toLowerCase();
    if (RUNNING_KEYWORDS.some((k) => rest.includes(k))) {
      return { type: "running", name: trimAfterColon(title), distanceKm: distance };
    }
    if (CYCLING_KEYWORDS.some((k) => rest.includes(k))) {
      return { type: "cycling", name: trimAfterColon(title), distanceKm: distance };
    }
    if (HIKING_KEYWORDS.some((k) => rest.includes(k))) {
      return { type: "hiking", name: trimAfterColon(title), distanceKm: distance };
    }
    if (SWIMMING_KEYWORDS.some((k) => rest.includes(k))) {
      return { type: "swimming", name: trimAfterColon(title), distanceKm: distance };
    }
    if (ROWING_KEYWORDS.some((k) => rest.includes(k))) {
      return { type: "rowing", name: trimAfterColon(title), distanceKm: distance };
    }
    return { type: "cardio", name: trimAfterColon(title) || "Cardio", distanceKm: distance };
  }

  // direktes Praefix ohne "Cardio:"
  for (const k of RUNNING_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "running", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }
  for (const k of CYCLING_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "cycling", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }
  for (const k of HIKING_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "hiking", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }
  for (const k of SWIMMING_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "swimming", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }
  for (const k of YOGA_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "yoga", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }
  for (const k of ROWING_KEYWORDS) {
    if (lower.startsWith(k)) {
      return { type: "rowing", name: trimAfterColon(title) || title, distanceKm: distance };
    }
  }

  return null;
}
