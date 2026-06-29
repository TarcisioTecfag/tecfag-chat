import { Smile, Paperclip, Send } from "lucide-react";

type Msg = {
  id: string;
  author?: string;
  time?: string;
  text: string;
  side: "in" | "out";
  avatar?: string;
  mention?: boolean;
  emojiOnly?: boolean;
};

const messages: Msg[] = [
  {
    id: "m0",
    author: "",
    text: "Hi everyone, let's start the call soon 😊",
    side: "in",
    avatar: "https://i.pravatar.cc/64?img=47",
  },
  {
    id: "m1",
    author: "Kate Johnson",
    time: "11:24 AM",
    text: "Recently I saw properties in a great location that I did not pay attention to before 😊",
    side: "in",
    avatar: "https://i.pravatar.cc/64?img=47",
  },
  {
    id: "m2",
    author: "Evan Scott",
    time: "11:25 AM",
    text: "Ooo, why don't you say something more",
    side: "in",
    avatar: "https://i.pravatar.cc/64?img=15",
  },
  {
    id: "m3",
    text: "@Robert ? 😄",
    side: "in",
    avatar: "https://i.pravatar.cc/64?img=15",
    mention: true,
  },
  {
    id: "m4",
    author: "You",
    time: "11:26 AM",
    text: "He creates an atmosphere of mystery 😄",
    side: "out",
  },
  { id: "m5", text: "😎 😊", side: "out", emojiOnly: true },
  {
    id: "m6",
    author: "Evan Scott",
    time: "11:34 AM",
    text: "Robert, don't be like that and say something more :) 😊",
    side: "in",
    avatar: "https://i.pravatar.cc/64?img=15",
  },
];

export function ChatPanel() {
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel shadow-soft">
      {/* Header */}
      <header className="flex items-center justify-between px-7 py-5">
        <h2 className="text-lg font-semibold text-foreground">Group Chat</h2>
        <div className="flex items-center gap-1 rounded-full bg-card/70 p-1">
          <button className="rounded-full bg-primary-soft px-5 py-1.5 text-sm font-medium text-primary">
            Messages
          </button>
          <button className="px-5 py-1.5 text-sm font-medium text-muted-foreground">
            Participants
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-7 pb-4">
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}

        {/* Typing */}
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-card">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:120ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:240ms]" />
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Robert</span> is typing
          </span>
        </div>
      </div>

      {/* Composer */}
      <div className="px-5 pb-5">
        <div className="flex items-center gap-3 rounded-2xl bg-card px-5 py-3 shadow-soft">
          <input
            placeholder="Write your message..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button className="text-muted-foreground hover:text-foreground">
            <Smile className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button className="text-muted-foreground hover:text-foreground">
            <Paperclip className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90">
            <Send className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </section>
  );
}

function MessageRow({ m }: { m: Msg }) {
  if (m.side === "out") {
    if (m.emojiOnly) {
      return (
        <div className="flex justify-end">
          <div className="rounded-2xl rounded-br-md bg-bubble-out px-4 py-2 text-lg">
            {m.text}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end">
        {(m.author || m.time) && (
          <div className="mb-1 text-xs text-muted-foreground">
            {m.author}, {m.time}
          </div>
        )}
        <div className="max-w-[70%] rounded-2xl rounded-br-md bg-bubble-out px-4 py-3 text-sm text-foreground">
          {m.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3">
      <img
        src={m.avatar}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
      <div className="min-w-0 max-w-[75%]">
        {(m.author || m.time) && (
          <div className="mb-1 text-xs text-muted-foreground">
            {m.author}
            {m.time ? `, ${m.time}` : ""}
          </div>
        )}
        <div
          className={`inline-block rounded-2xl rounded-bl-md px-4 py-3 text-sm text-foreground ${
            m.mention ? "bg-card font-medium" : "bg-card"
          }`}
        >
          {m.mention ? (
            <span>
              <span className="text-primary">@Robert</span> ? 😄
            </span>
          ) : (
            m.text
          )}
        </div>
      </div>
    </div>
  );
}
