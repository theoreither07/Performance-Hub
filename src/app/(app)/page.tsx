import { TodayTodosWidget } from "@/components/widgets/today-todos";
import { WeatherWidget } from "@/components/widgets/weather";
import { CalendarTodayWidget } from "@/components/widgets/calendar-today";
import { GreetingWidget } from "@/components/widgets/greeting";
import { StatsWidget } from "@/components/widgets/stats";
import { UpcomingWidget } from "@/components/widgets/upcoming";
import { DailyAdviceWidget } from "@/components/widgets/daily-advice";
import { HealthWidget } from "@/components/widgets/health";
import { MailWidget } from "@/components/widgets/mail";
import { HabitsWidget } from "@/components/widgets/habits";

export default function DashboardPage() {
  return (
    <div className="space-y-4 lg:space-y-6">
      <GreetingWidget />
      <StatsWidget />
      <HealthWidget />
      <DailyAdviceWidget />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          <TodayTodosWidget />
          <HabitsWidget />
          <UpcomingWidget />
        </div>
        <div className="space-y-4 lg:space-y-6">
          <WeatherWidget />
          <CalendarTodayWidget />
          <MailWidget />
        </div>
      </div>
    </div>
  );
}
