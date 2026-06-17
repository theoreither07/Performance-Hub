import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

export function ComingSoon({
  title,
  phase,
  description,
  features,
}: {
  title: string;
  phase: number;
  description: string;
  features: string[];
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge>Phase {phase}</Badge>
          <span className="text-xs text-muted-foreground">In Vorbereitung</span>
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm mt-1">{description}</p>
      </div>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            Was reinkommt:
          </div>
          <ul className="space-y-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">&#x2022;</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
