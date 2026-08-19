import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { User, UserSettings, InsertNotification, Notification } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({
  storage: {
    getAllUsers: vi.fn(),
    getUserSettings: vi.fn(),
    addNotification: vi.fn(),
  },
}));

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
}));

vi.mock("../apprise.js", () => ({
  appriseClient: { send: vi.fn() },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("../log-file.js", () => ({
  readLastLogLines: vi.fn().mockResolvedValue(["log line 1", "log line 2"]),
}));

vi.mock("../logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: mockLogger,
    igdbLogger: mockLogger,
    routesLogger: mockLogger,
    expressLogger: mockLogger,
    downloadersLogger: mockLogger,
    torznabLogger: mockLogger,
    searchLogger: mockLogger,
    telemetryLogger: mockLogger,
  };
});

const baseUser: User = {
  id: "user-1",
  username: "tester",
  password: "hash",
  createdAt: new Date(),
} as unknown as User;

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings-1",
    userId: "user-1",
    telemetryEnabled: false,
    notificationPreferences: null,
    ...overrides,
  } as UserSettings;
}

describe("error-telemetry", () => {
  let storageMock: {
    getAllUsers: Mock;
    getUserSettings: Mock;
    addNotification: Mock;
  };
  let notifyUserMock: Mock;
  let appriseClientMock: { send: Mock };
  let safeFetchMock: Mock;
  let reportServerError: (typeof import("../error-telemetry.js"))["reportServerError"];
  let sendPendingReport: (typeof import("../error-telemetry.js"))["sendPendingReport"];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const storageModule = await import("../storage.js");
    storageMock = storageModule.storage as unknown as typeof storageMock;

    const socketModule = await import("../socket.js");
    notifyUserMock = socketModule.notifyUser as unknown as Mock;

    const appriseModule = await import("../apprise.js");
    appriseClientMock = appriseModule.appriseClient as unknown as typeof appriseClientMock;

    const ssrfModule = await import("../ssrf.js");
    safeFetchMock = ssrfModule.safeFetch as unknown as Mock;

    const errorTelemetry = await import("../error-telemetry.js");
    reportServerError = errorTelemetry.reportServerError;
    sendPendingReport = errorTelemetry.sendPendingReport;

    storageMock.addNotification.mockImplementation(
      async (n: InsertNotification): Promise<Notification> =>
        ({ ...n, id: "notif-1", read: false, createdAt: new Date() }) as Notification
    );
  });

  it("creates an actionable notification (no auto-send) when telemetryEnabled is false", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(makeSettings({ telemetryEnabled: false }));

    await reportServerError(new Error("boom"), { source: "expressErrorHandler" });

    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(storageMock.addNotification).toHaveBeenCalledTimes(1);
    const notification = storageMock.addNotification.mock.calls[0][0] as InsertNotification;
    expect(notification.title).toBe("An error occurred");
    expect(notification.link).toMatch(/^error-report:/);
    expect(notifyUserMock).toHaveBeenCalledWith("notification", expect.anything());
  });

  it("auto-sends and creates an info notification when telemetryEnabled is true", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(makeSettings({ telemetryEnabled: true }));
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: "1234", issueNumber: 42 }),
    });

    await reportServerError(new Error("boom"), { source: "expressErrorHandler" });

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = safeFetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body as string);
    expect(body.reportType).toBe("telemetry-auto");
    expect(body.logs).toContain("AUTOMATED TELEMETRY REPORT");

    expect(storageMock.addNotification).toHaveBeenCalledTimes(1);
    const notification = storageMock.addNotification.mock.calls[0][0] as InsertNotification;
    expect(notification.type).toBe("info");
    expect(notification.title).toBe("Automated error report sent");
    expect(notification.link).toBeUndefined();
  });

  it("skips users who disabled the errorDetected notification", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(
      makeSettings({
        notificationPreferences: JSON.stringify({
          errorDetected: { inApp: false, apprise: false },
        }),
      })
    );

    await reportServerError(new Error("boom"), { source: "uncaughtException" });

    expect(storageMock.addNotification).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("does not report again within the cooldown window", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(makeSettings());

    await reportServerError(new Error("first"), { source: "expressErrorHandler" });
    await reportServerError(new Error("second"), { source: "expressErrorHandler" });

    expect(storageMock.getAllUsers).toHaveBeenCalledTimes(1);
    expect(storageMock.addNotification).toHaveBeenCalledTimes(1);
  });

  it("sendPendingReport reports an unknown/expired report id as not available", async () => {
    const result = await sendPendingReport("does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no longer available/i);
    }
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("sendPendingReport sends a telemetry-prompted report for a pending id", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(makeSettings({ telemetryEnabled: false }));
    await reportServerError(new Error("boom"), { source: "expressErrorHandler" });

    const notification = storageMock.addNotification.mock.calls[0][0] as InsertNotification;
    const reportId = notification.link!.split(":").pop()!;

    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: "5678", issueNumber: 7 }),
    });

    const result = await sendPendingReport(reportId);

    expect(result.ok).toBe(true);
    const [, requestInit] = safeFetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body as string);
    expect(body.reportType).toBe("telemetry-prompted");

    // Second send for the same id should fail — it was deleted after success.
    const secondResult = await sendPendingReport(reportId);
    expect(secondResult.ok).toBe(false);
  });

  it("does not call apprise when the errorDetected apprise preference is off", async () => {
    storageMock.getAllUsers.mockResolvedValue([baseUser]);
    storageMock.getUserSettings.mockResolvedValue(makeSettings());

    await reportServerError(new Error("boom"), { source: "expressErrorHandler" });

    expect(appriseClientMock.send).not.toHaveBeenCalled();
  });
});
