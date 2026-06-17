"use client";

import * as React from "react";

function greeting(hour: number) {
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Guten Morgen";
  if (hour < 14) return "Mahlzeit";
  if (hour < 18) return "Guten Tag";
  if (hour < 22) return "Guten Abend";
  return "Gute Nacht";
}

export function GreetingWidget() {
  const [hour, setHour] = React.useState<number>(new Date().getHours());
  React.useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  const name = process.env.NEXT_PUBLIC_USER_NAME?.trim();

  return (
    <div className="animate-fade-slide-in">
      <h1 className="text-xl sm:text-3xl font-bold tracking-tight">
        {greeting(hour)}{name ? `, ${name}` : ""}. <span className="text-primary">Lets go.</span>
      </h1>
      <p className="text-xs sm:text-sm text-muted-foreground mt-1">
        Dein Tagesueberblick auf einen Blick.
      </p>
    </div>
  );
}
