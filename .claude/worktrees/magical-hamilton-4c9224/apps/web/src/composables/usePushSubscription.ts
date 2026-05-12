import { onMounted, ref } from "vue";
import { api } from "src/lib/api-client";

export interface PushSubscriptionInfo {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

export function usePushSubscription() {
  const supported = ref(false);
  const permission = ref<PushPermissionState>("default");
  const isSubscribed = ref(false);
  const subscriptions = ref<PushSubscriptionInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function checkSupport(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  async function refresh(): Promise<void> {
    if (!checkSupport()) {
      supported.value = false;
      permission.value = "unsupported";
      return;
    }
    supported.value = true;
    permission.value = Notification.permission as PushPermissionState;

    const reg = await navigator.serviceWorker.getRegistration("/push-service-worker.js");
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      isSubscribed.value = sub !== null;
    } else {
      isSubscribed.value = false;
    }

    try {
      const res = await api.get<{ ok: boolean; data: PushSubscriptionInfo[] }>(
        "/push/subscriptions"
      );
      subscriptions.value = res.data.data;
    } catch (e) {
      console.error("[push] Failed to fetch subscriptions:", e);
    }
  }

  async function subscribe(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await Notification.requestPermission();
      permission.value = result as PushPermissionState;
      if (result !== "granted") {
        error.value = "permission_denied";
        return;
      }

      const reg = await navigator.serviceWorker.register("/push-service-worker.js");
      await navigator.serviceWorker.ready;

      const keyRes = await api.get<{ ok: boolean; data: { publicKey: string } }>(
        "/push/vapid-public-key"
      );
      const vapidPublicKey = keyRes.data.data.publicKey;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = sub.toJSON();
      await api.post("/push/subscriptions", {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        userAgent: navigator.userAgent,
      });

      isSubscribed.value = true;
      await refresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "subscribe_failed";
      console.error("[push] Subscribe failed:", e);
    } finally {
      loading.value = false;
    }
  }

  async function unsubscribeCurrent(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/push-service-worker.js");
      if (!reg) {
        isSubscribed.value = false;
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        isSubscribed.value = false;
        return;
      }

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      const matching = subscriptions.value.find((s) => s.endpoint === endpoint);
      if (matching) {
        await api.delete(`/push/subscriptions/${matching.id}`);
      }

      isSubscribed.value = false;
      await refresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "unsubscribe_failed";
    } finally {
      loading.value = false;
    }
  }

  async function deleteSubscription(id: string): Promise<void> {
    loading.value = true;
    try {
      await api.delete(`/push/subscriptions/${id}`);
      await refresh();
    } finally {
      loading.value = false;
    }
  }

  async function sendTest(): Promise<void> {
    await api.post("/push/test");
  }

  onMounted(() => {
    void refresh();
  });

  return {
    supported,
    permission,
    isSubscribed,
    subscriptions,
    loading,
    error,
    refresh,
    subscribe,
    unsubscribeCurrent,
    deleteSubscription,
    sendTest,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
