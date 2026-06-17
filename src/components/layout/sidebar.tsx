"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Calendar,
  HeartPulse,
  Mail,
  Notebook,
  Settings,
  Sparkles,
  LogOut,
  Repeat,
  CalendarRange,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

function UserFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  if (!session?.user) return null;
  const email = session.user.email ?? "";
  const initials = email[0]?.toUpperCase() ?? "?";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" title={email}>{email}</p>
      </div>
      <button
        onClick={() => {
          onNavigate?.();
          void signOut({ callbackUrl: "/signin" });
        }}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        aria-label="Abmelden"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  mobileNav?: boolean;
  soon?: boolean;
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, mobileNav: true },
  { href: "/todos", label: "ToDos", icon: CheckSquare, mobileNav: true },
  { href: "/projects", label: "Projekte", icon: FolderKanban, mobileNav: true },
  { href: "/calendar", label: "Kalender", icon: Calendar, mobileNav: true },
  {
    href: "/health",
    label: "Health",
    icon: HeartPulse,
    mobileNav: true,
    children: [
      { href: "/health/wochenplan", label: "Wochenplanung", icon: CalendarRange },
    ],
  },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/habits", label: "Habits", icon: Repeat },
  { href: "/notes", label: "Notizen", icon: Notebook, soon: true },
  { href: "/coach", label: "Daily Coach", icon: Sparkles, soon: true },
];

// Einstellungen separat — wird ganz unten gerendert.
const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Einstellungen", icon: Settings };

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-2" onClick={onNavigate}>
          <div className="h-9 w-9 rounded-lg bg-brand-lime flex items-center justify-center">
            <span className="font-black text-lg text-brand-black">
              {(process.env.NEXT_PUBLIC_USER_NAME?.trim()?.[0] ?? "D").toUpperCase()}
            </span>
          </div>
          <div>
            <p className="font-bold leading-none">Dashboard</p>
            {process.env.NEXT_PUBLIC_USER_NAME?.trim() && (
              <p className="text-xs text-muted-foreground mt-0.5">{process.env.NEXT_PUBLIC_USER_NAME.trim()}</p>
            )}
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV_ITEMS.map((item) => {
          const active = path === item.href || (item.href !== "/" && path.startsWith(item.href));
          const Icon = item.icon;
          const showChildren = item.children && item.children.length > 0 && active;
          return (
            <div key={item.href} className="space-y-1">
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  item.soon && "opacity-60",
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
                {item.soon && <span className="text-[10px] uppercase tracking-wider">Bald</span>}
              </Link>
              {showChildren && (
                <div className="pl-6 space-y-1">
                  {item.children!.map((child) => {
                    const childActive = path === child.href || path.startsWith(child.href + "/");
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors border-l border-border/40",
                          childActive
                            ? "bg-primary/10 text-primary border-primary/60"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <ChildIcon className="h-3.5 w-3.5" />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="px-3 pb-2 pt-2 border-t border-border">
        {(() => {
          const active = path === SETTINGS_ITEM.href || path.startsWith(SETTINGS_ITEM.href);
          const Icon = SETTINGS_ITEM.icon;
          return (
            <Link
              href={SETTINGS_ITEM.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {SETTINGS_ITEM.label}
            </Link>
          );
        })()}
      </div>
      <div className="px-3 pb-3 border-t border-border">
        <UserFooter onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card/40 sticky top-0 h-screen">
      <SidebarContent />
    </aside>
  );
}
