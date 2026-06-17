import { ComingSoon } from "@/components/layout/coming-soon";

export default function NotesPage() {
  return (
    <ComingSoon
      title="Notizen / Knowledge Base"
      phase={4}
      description="Markdown-Notizen mit Tags und Volltextsuche."
      features={["Markdown-Editor", "Tags + Backlinks", "Volltextsuche (Postgres FTS)"]}
    />
  );
}
