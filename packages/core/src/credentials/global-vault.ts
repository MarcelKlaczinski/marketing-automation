import { eq, and } from "drizzle-orm";
import { db, globalCredentials } from "@marketing-auto/db";
import { encrypt, decrypt } from "./crypto.ts";

export async function getGlobal(service: string, key: string): Promise<string | null> {
  const rows = await db
    .select({ encryptedValue: globalCredentials.encryptedValue })
    .from(globalCredentials)
    .where(and(eq(globalCredentials.service, service), eq(globalCredentials.key, key)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return decrypt(row.encryptedValue);
}

export async function setGlobal(
  service: string,
  key: string,
  value: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const encryptedValue = encrypt(value);
  await db
    .insert(globalCredentials)
    .values({ service, key, encryptedValue, metadata: metadata ?? {} })
    .onConflictDoUpdate({
      target: [globalCredentials.service, globalCredentials.key],
      set: { encryptedValue, metadata: metadata ?? {}, updatedAt: new Date() },
    });
}

export async function deleteGlobal(service: string, key: string): Promise<void> {
  await db
    .delete(globalCredentials)
    .where(and(eq(globalCredentials.service, service), eq(globalCredentials.key, key)));
}

export async function listGlobal(
  service?: string,
): Promise<Array<{ service: string; key: string; metadata: Record<string, unknown> | null; updatedAt: Date }>> {
  const query = db
    .select({
      service: globalCredentials.service,
      key: globalCredentials.key,
      metadata: globalCredentials.metadata,
      updatedAt: globalCredentials.updatedAt,
    })
    .from(globalCredentials);

  if (service) {
    return query.where(eq(globalCredentials.service, service));
  }
  return query;
}
