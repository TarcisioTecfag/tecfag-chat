import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Group Chat — Real estate deals" },
      { name: "description", content: "Minimal SaaS chat workspace with shared files and conversations." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex h-screen max-w-[1440px] gap-5 p-5">
        <Sidebar />
        <ChatList />
        <ChatPanel />
        <SharedFiles />
      </div>
    </div>
  );
}
