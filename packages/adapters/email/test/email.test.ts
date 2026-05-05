import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, costLogs } from "@marketing-auto/db";
import { sendEmail, sendMagicLinkEmail, PLATFORM_PROJECT_ID } from "../src/client.ts";

describe("Email adapter (dev fallback)", () => {
  it("returns dev-fallback result when SMTP creds absent", async () => {
    const originalUser = process.env.SMTP_USER;
    const originalPass = process.env.SMTP_APP_PASSWORD;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    const { resetEnvCache } = await import("@marketing-auto/shared");
    resetEnvCache();

    try {
      const result = await sendEmail({
        projectId: null,
        operation: "test-fallback",
        to: "test@example.com",
        subject: "Test",
        html: "<p>Test</p>",
      });

      expect(result.delivered).toBe(false);
      expect(result.messageId).toBe("dev-fallback");
    } finally {
      if (originalUser) process.env.SMTP_USER = originalUser;
      if (originalPass) process.env.SMTP_APP_PASSWORD = originalPass;
      resetEnvCache();
    }
  });
});

const live = process.env.RUN_LIVE_SMTP === "1";
(live ? describe : describe.skip)("Email adapter (LIVE Gmail SMTP)", () => {
  let projectId: string;
  const slug = `email-test-${Date.now()}`;

  beforeAll(async () => {
    await db
      .insert(projects)
      .values({
        id: PLATFORM_PROJECT_ID,
        slug: "_platform",
        name: "Platform",
        industry: "other",
        pipelineTemplate: "educational",
        costLimits: { daily: { smtp: 0 }, monthly: { smtp: 0 } },
      })
      .onConflictDoNothing();

    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Email Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: { daily: { smtp: 0 }, monthly: { smtp: 0 } },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("sends a magic link email and writes cost log to platform project", async () => {
    const result = await sendMagicLinkEmail({
      to: process.env.SMTP_TEST_RECIPIENT!,
      verifyUrl: "https://example.com/verify?token=test",
      expiresInMinutes: 15,
    });

    expect(result.delivered).toBe(true);
    expect(result.messageId).not.toBe("dev-fallback");
    expect(result.messageId.length).toBeGreaterThan(5);

    const platformLogs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.projectId, PLATFORM_PROJECT_ID));
    expect(platformLogs.length).toBeGreaterThan(0);
    const last = platformLogs[platformLogs.length - 1]!;
    expect(last.operation).toBe("magic-link");
    expect(Number(last.costEur)).toBe(0);
  }, 30_000);

  it("attributes cost to a specific project when projectId provided", async () => {
    const result = await sendEmail({
      projectId,
      operation: "test-attribution",
      to: process.env.SMTP_TEST_RECIPIENT!,
      subject: "Spec 11.5 attribution test",
      html: "<p>Attribution test</p>",
      text: "Attribution test",
    });

    expect(result.delivered).toBe(true);

    const logs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(logs[0]!.operation).toBe("test-attribution");
  }, 30_000);
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.sendEmail).toBe("function");
    expect(typeof mod.sendMagicLinkEmail).toBe("function");
    expect(mod.PLATFORM_PROJECT_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof mod.email.sendEmail).toBe("function");
  });
});
