import { ChevronLeft, Search, Plus, MoreVertical, Settings, ChevronDown } from "lucide-react";

type Conv = {
  id: string;
  name: string;
  preview: string;
  time: string;
  avatar: string;
  active?: boolean;
  initials?: string;
  initialsBg?: string;
};

const conversations: Conv[] = [
  {
    id: "1",
    name: "Real estate deals",
    preview: "typing...",
    time: "11:15",
    avatar: "https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=120&h=120&fit=crop",
    active: true,
  },
  {
    id: "2",
    name: "Kate Johnson",
    preview: "I will send the document s...",
    time: "11:15",
    avatar: "https://i.pravatar.cc/80?img=47",
  },
  {
    id: "3",
    name: "Tamara Shevchenko",
    preview: "are you going to a busine...",
    time: "10:05",
    avatar: "",
    initials: "TS",
    initialsBg: "#e9d5b8",
  },
  {
    id: "4",
    name: "Joshua Clarkson",
    preview: "I suggest to start, I have n...",
    time: "15.09",
    avatar: "https://i.pravatar.cc/80?img=15",
  },
  {
    id: "5",
    name: "Jeroen Zoet",
    preview: "We need to start a new re...",
    time: "14.09",
    avatar: "https://i.pravatar.cc/80?img=33",
  },
];

export function ChatList() {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col rounded-3xl bg-card px-5 py-6 shadow-soft">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-border">
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 className="text-xl font-semibold text-foreground">Chat</h2>
      </div>

      <div className="my-5 h-px bg-line" />

      {/* Profile */}
      <div className="relative flex flex-col items-center">
        <button className="absolute right-0 top-1 text-muted-foreground hover:text-foreground">
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="relative">
          <img
            src="https://i.pravatar.cc/160?img=12"
            alt="Jontray Arnold"
            className="h-[88px] w-[88px] rounded-full object-cover"
          />
          <span className="absolute bottom-1 right-2 h-3 w-3 rounded-full border-2 border-card bg-primary" />
        </div>
        <h3 className="mt-3 text-[17px] font-semibold text-foreground">Jontray Arnold</h3>
        <button className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
          available
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>

      {/* Search */}
      <div className="relative mt-5">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
        <input
          placeholder="Search"
          className="h-10 w-full rounded-xl bg-muted px-4 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {/* Last chats header */}
      <div className="mt-5 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Last chats</h4>
        <div className="flex items-center gap-1">
          <button className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-primary">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <button className="grid h-6 w-6 place-items-center text-muted-foreground">
            <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* List */}
      <ul className="scrollbar-thin mt-3 flex-1 space-y-1 overflow-y-auto -mr-2 pr-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150 ${
                c.active ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              {c.avatar ? (
                <img src={c.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
              ) : (
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-foreground"
                  style={{ background: c.initialsBg }}
                >
                  {c.initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{c.time}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
