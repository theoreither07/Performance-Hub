import { NextResponse } from "next/server";

const LAT = process.env.WEATHER_LAT ?? "48.2082";
const LON = process.env.WEATHER_LON ?? "16.3738";

// Open-Meteo: kein API-Key benoetigt.
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Europe%2FVienna&forecast_days=7`;

// Dynamisch (kein route-level Prerender) — sonst versucht Next den Cache-Body auf die
// read-only Container-Platte zu schreiben (EROFS). Der Upstream-Fetch wird weiter 10min
// gecacht (fetch-level revalidate unten, landet im beschreibbaren .next/cache-tmpfs).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(URL, { next: { revalidate: 600 } });
    if (!res.ok) {
      return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
    }
    const json = await res.json();
    const c = json.current;
    const d = json.daily;

    return NextResponse.json({
      current: {
        temperature: c.temperature_2m,
        apparentTemperature: c.apparent_temperature,
        weatherCode: c.weather_code,
        windSpeed: c.wind_speed_10m,
        isDay: c.is_day === 1,
      },
      daily: (d.time as string[]).map((date: string, i: number) => ({
        date,
        tempMin: d.temperature_2m_min[i],
        tempMax: d.temperature_2m_max[i],
        precipitation: d.precipitation_sum[i],
        weatherCode: d.weather_code[i],
        windSpeedMax: d.wind_speed_10m_max[i],
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
