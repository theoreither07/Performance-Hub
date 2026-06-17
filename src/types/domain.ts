// Domain-Types, die sowohl Server (Prisma) als auch Client (Dexie) nutzen.
// Werden 1:1 als String-Literals gehalten damit Dexie sie speichern kann
// ohne Prisma-Enums in den Browser zu ziehen.

export type LifeArea = "PRIVATE" | "FH" | "BUSINESS";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "WAITING" | "DONE" | "CANCELLED";

export const LIFE_AREAS: { value: LifeArea; label: string; color: string }[] = [
  { value: "PRIVATE", label: "Privat", color: "#60A5FA" },
  { value: "FH", label: "FH", color: "#A78BFA" },
  { value: "BUSINESS", label: "Business", color: "#AAFF00" },
];

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Niedrig" },
  { value: "MEDIUM", label: "Mittel" },
  { value: "HIGH", label: "Hoch" },
  { value: "URGENT", label: "Dringend" },
];

export interface CalendarEvent {
  id: string;
  accountEmail: string;
  accountKind: "PRIVATE" | "BUSINESS";
  title: string;
  start: string; // ISO
  end: string;
  location?: string;
  description?: string;
  allDay: boolean;
}

export interface WeatherDay {
  date: string;          // YYYY-MM-DD
  tempMin: number;
  tempMax: number;
  precipitation: number;
  weatherCode: number;
  windSpeedMax: number;
}

export interface WeatherCurrent {
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  windSpeed: number;
  isDay: boolean;
}
