import {
  Clock,
  ClipboardCheck,
  Eye,
  Users,
  BarChart2,
  Video,
} from "lucide-react";

const items = [
  { icon: Clock, label: "Recent" },
  { icon: ClipboardCheck, label: "Tasks" },
  { icon: Eye, label: "Watch" },
  { icon: Users, label: "Chat", active: true },
  { icon: BarChart2, label: "Stats" },
  { icon: Video, label: "Video" },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center justify-between py-6">
      {/* Logo */}
      <div className="flex flex-col items-center gap-10">
        <div className="text-foreground">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <path d="M4 4 L13 22 L22 4 L17 4 L13 12 L9 4 Z" fill="#2dc4a0" />
            <path d="M9 4 L13 12 L17 4 Z" fill="#e15a5a" />
          </svg>
        </div>

        <nav className="flex flex-col items-center gap-3">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.label}
                aria-label={it.label}
                className={`relative grid h-11 w-11 place-items-center rounded-2xl transition-colors duration-150 ${
                  it.active
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {it.active && (
                  <span className="absolute -left-6 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                )}
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </button>
            );
          })}
        </nav>
      </div>

      {/* user avatar */}
      <img
        src="https://i.pravatar.cc/80?img=12"
        alt="Me"
        className="h-10 w-10 rounded-full object-cover"
      />
    </aside>
  );
}
