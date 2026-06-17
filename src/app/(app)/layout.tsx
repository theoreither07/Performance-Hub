import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { MobileBottomNav } from "@/components/layout/mobile-nav";
import { CoachChat } from "@/components/health/coach-chat";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <OfflineBanner />
        <div className="flex-1 overflow-auto scrollbar-thin pb-20 lg:pb-0">
          <div className="mx-auto max-w-7xl px-4 py-5 lg:px-8 lg:py-6">{children}</div>
        </div>
      </main>
      <MobileBottomNav />
      <CoachChat />
    </div>
  );
}
