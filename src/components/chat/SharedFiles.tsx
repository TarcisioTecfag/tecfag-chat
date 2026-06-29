import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Film, Files, MoreVertical, Folder, Link2 } from "lucide-react";

const categories = [
  {
    icon: FileText,
    label: "Documents",
    count: "126 files, 193MB",
    color: "var(--icon-docs)",
    bg: "var(--icon-docs-bg)",
  },
  {
    icon: ImageIcon,
    label: "Photos",
    count: "53 files, 321MB",
    color: "var(--icon-photos)",
    bg: "var(--icon-photos-bg)",
  },
  {
    icon: Film,
    label: "Movies",
    count: "3 files, 210MB",
    color: "var(--icon-movies)",
    bg: "var(--icon-movies-bg)",
  },
  {
    icon: Files,
    label: "Other",
    count: "49 files, 194MB",
    color: "var(--icon-other)",
    bg: "var(--icon-other-bg)",
  },
];

export function SharedFiles() {
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col rounded-3xl bg-card px-6 py-6 shadow-soft">
      <div className="flex items-center gap-3">
        <button className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-xl font-semibold text-foreground">Shared files</h2>
      </div>

      <div className="my-5 h-px bg-line" />

      {/* Group */}
      <div className="flex flex-col items-center">
        <img
          src="https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=200&h=200&fit=crop"
          alt="Real estate deals"
          className="h-[88px] w-[88px] rounded-full object-cover"
        />
        <h3 className="mt-3 text-[17px] font-semibold text-foreground">Real estate deals</h3>
        <p className="mt-1 text-xs text-muted-foreground">10 members</p>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="relative rounded-2xl bg-primary-soft p-4">
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary" />
          <div className="text-[11px] font-medium text-foreground/70">All files</div>
          <div className="mt-6 flex items-end justify-between">
            <Folder className="h-7 w-7 text-primary" fill="currentColor" strokeWidth={0} />
            <span className="text-2xl font-bold text-foreground">231</span>
          </div>
        </div>
        <div className="relative rounded-2xl bg-muted p-4">
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-card ring-1 ring-border" />
          <div className="text-[11px] font-medium text-foreground/70">All links</div>
          <div className="mt-6 flex items-end justify-between">
            <Link2 className="h-7 w-7 text-muted-foreground" strokeWidth={2} />
            <span className="text-2xl font-bold text-foreground">45</span>
          </div>
        </div>
      </div>

      {/* File type */}
      <div className="mt-6 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">File type</h4>
        <button className="text-muted-foreground">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {categories.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.label}>
              <button className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-muted/60">
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{ background: c.bg }}
                >
                  <Icon className="h-5 w-5" style={{ color: c.color }} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.count}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
