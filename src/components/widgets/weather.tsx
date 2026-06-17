"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Cloud, CloudRain, Sun, Snowflake, CloudFog, CloudLightning, CloudSun } from "lucide-react";
import { format } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import type { WeatherCurrent, WeatherDay } from "@/types/domain";

function iconFor(code: number) {
  if ([0, 1].includes(code)) return Sun;
  if ([2].includes(code)) return CloudSun;
  if ([3].includes(code)) return Cloud;
  if ([45, 48].includes(code)) return CloudFog;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return CloudRain;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return Snowflake;
  if ([95, 96, 99].includes(code)) return CloudLightning;
  return Cloud;
}

export function WeatherWidget() {
  const { data, isLoading } = useQuery<{ current: WeatherCurrent; daily: WeatherDay[] }>({
    queryKey: ["weather"],
    queryFn: async () => {
      const res = await fetch("/api/weather");
      if (!res.ok) throw new Error("weather");
      return res.json();
    },
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });

  const CurrentIcon = data?.current ? iconFor(data.current.weatherCode) : Cloud;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Wetter Wien</span>
          {data?.current && <CurrentIcon className="h-5 w-5 text-primary" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Laden...</p>}
        {data?.current && (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">{Math.round(data.current.temperature)}&deg;</span>
              <span className="text-sm text-muted-foreground">
                gefuehlt {Math.round(data.current.apparentTemperature)}&deg;
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Wind {Math.round(data.current.windSpeed)} km/h
            </p>
            <div className="grid grid-cols-7 gap-1 mt-4">
              {data.daily.slice(0, 7).map((d) => {
                const Icon = iconFor(d.weatherCode);
                return (
                  <div key={d.date} className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {format(new Date(d.date), "EE", { locale: de })}
                    </p>
                    <Icon className="h-4 w-4 mx-auto my-1 text-muted-foreground" />
                    <p className="text-xs font-medium">{Math.round(d.tempMax)}&deg;</p>
                    <p className="text-[10px] text-muted-foreground">{Math.round(d.tempMin)}&deg;</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
