import { eq, and } from "drizzle-orm";
import { db, projectCredentials } from "@marketing-auto/db";
import { type Result, err, tryAsync } from "@marketing-auto/shared";
import { encryptJson, decryptJson } from "./crypto.ts";
import type { CredentialService, CredentialPayload } from "./types.ts";

export class CredentialVault {
  /**
   * Stores or replaces credentials for a project + service.
   * The payload is encrypted before storage.
   */
  async store<S extends CredentialService>(input: {
    projectId: string;
    service: S;
    payload: CredentialPayload<S>;
    expiresAt?: Date;
  }): Promise<Result<{ id: string }>> {
    return tryAsync(async () => {
      const encryptedPayload = encryptJson(input.payload);
      const expiresAt = input.expiresAt ?? null;

      const [row] = await db
        .insert(projectCredentials)
        .values({
          projectId: input.projectId,
          service: input.service,
          encryptedPayload,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [projectCredentials.projectId, projectCredentials.service],
          set: {
            encryptedPayload,
            expiresAt,
            updatedAt: new Date(),
          },
        })
        .returning({ id: projectCredentials.id });

      if (!row) throw new Error("Insert returned no row");
      return { id: row.id };
    });
  }

  /**
   * Retrieves and decrypts credentials for a project + service.
   * Returns err("NotFound") if not present.
   */
  async get<S extends CredentialService>(input: {
    projectId: string;
    service: S;
  }): Promise<Result<{ payload: CredentialPayload<S>; expiresAt: Date | null }, "NotFound" | Error>> {
    const rows = await db
      .select()
      .from(projectCredentials)
      .where(
        and(
          eq(projectCredentials.projectId, input.projectId),
          eq(projectCredentials.service, input.service),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return err("NotFound" as const);

    return tryAsync(async () => ({
      payload: decryptJson<CredentialPayload<S>>(row.encryptedPayload),
      expiresAt: row.expiresAt,
    }));
  }

  /**
   * Lists which services have credentials configured for a project.
   * Does NOT return any payload data.
   */
  async listServices(input: { projectId: string }): Promise<
    Array<{
      service: CredentialService;
      expiresAt: Date | null;
      updatedAt: Date;
    }>
  > {
    return db
      .select({
        service: projectCredentials.service,
        expiresAt: projectCredentials.expiresAt,
        updatedAt: projectCredentials.updatedAt,
      })
      .from(projectCredentials)
      .where(eq(projectCredentials.projectId, input.projectId));
  }

  /**
   * Deletes credentials for a project + service. No-op if absent.
   */
  async delete(input: { projectId: string; service: CredentialService }): Promise<Result<void>> {
    return tryAsync(async () => {
      await db
        .delete(projectCredentials)
        .where(
          and(
            eq(projectCredentials.projectId, input.projectId),
            eq(projectCredentials.service, input.service),
          ),
        );
    });
  }
}

export const credentialVault = new CredentialVault();
