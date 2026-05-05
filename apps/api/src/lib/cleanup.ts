import { lt } from "drizzle-orm";
import { db, magicLinkTokens, sessions } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cleanup");

/**
 * Delete expired magic link tokens (older than 24h) and expired sessions.
 * Will be wired into a BullMQ scheduled job in Spec 05.
 */
export async function runAuthCleanup(): Promise<{
  tokensDeleted: number;
  sessionsDeleted: number;
}> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000);

  const tokensResult = await db
    .delete(magicLinkTokens)
    .where(lt(magicLinkTokens.expiresAt, oneDayAgo))
    .returning({ id: magicLinkTokens.id });

  const sessionsResult = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  log.info(
    { tokensDeleted: tokensResult.length, sessionsDeleted: sessionsResult.length },
    "Auth cleanup ran",
  );

  return {
    tokensDeleted: tokensResult.length,
    sessionsDeleted: sessionsResult.length,
  };
}
