import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

export interface NotificationRow {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  link: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsState {
  list: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  sseConnected: boolean;
}

export const useNotificationsStore = defineStore("notifications", {
  state: (): NotificationsState => ({
    list: [],
    unreadCount: 0,
    loading: false,
    sseConnected: false,
  }),

  actions: {
    async fetchList(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { notifications: NotificationRow[]; unreadCount: number };
        }>("/notifications?limit=50");
        this.list = res.data.data.notifications;
        this.unreadCount = res.data.data.unreadCount;
      } finally {
        this.loading = false;
      }
    },

    async fetchUnreadCount(): Promise<void> {
      const res = await api.get<{ ok: boolean; data: { count: number } }>(
        "/notifications/unread-count"
      );
      this.unreadCount = res.data.data.count;
    },

    async markAsRead(ids: string[]): Promise<void> {
      await api.post("/notifications/mark-read", { ids });
      const now = new Date().toISOString();
      for (const id of ids) {
        const n = this.list.find((x) => x.id === id);
        if (n && !n.readAt) n.readAt = now;
      }
      await this.fetchUnreadCount();
    },

    async markAllAsRead(): Promise<void> {
      await api.post("/notifications/mark-all-read");
      const now = new Date().toISOString();
      for (const n of this.list) {
        if (!n.readAt) n.readAt = now;
      }
      this.unreadCount = 0;
    },

    addLive(n: NotificationRow): void {
      this.list.unshift(n);
      if (this.list.length > 100) this.list.pop();
      if (!n.readAt) this.unreadCount += 1;
    },

    setSseConnected(connected: boolean): void {
      this.sseConnected = connected;
    },
  },
});
