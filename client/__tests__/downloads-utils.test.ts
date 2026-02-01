import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatSpeed,
  formatETA,
  getStatusColor,
  getStatusBadgeVariant,
  filterDownloadsByStatus,
  shouldShowSpeedBadge,
  shouldShowETABadge,
  shouldShowRatioBadge,
  shouldShowSizeBadge,
  shouldShowPeersBadge,
  getDownloadTypeColor,
  getDownloadTypeBadgeVariant,
  getDownloadTypeTextExColor,
  formatDownloadType,
  shouldShowTorrentMetrics,
  shouldShowUsenetMetrics,
  shouldShowRepairStatus,
  shouldShowUnpackStatus,
  getRepairStatusBadgeVariant,
  getUnpackStatusBadgeVariant,
  formatRepairStatus,
  formatUnpackStatus,
  formatAge,
  isUsenetItem,
  type DownloadData,
  type DownloadStatusType,
} from "../src/lib/downloads-utils";

describe("formatBytes", () => {
  it('should return "0 B" for 0 bytes', () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format bytes correctly", () => {
    expect(formatBytes(100)).toBe("100 B");
  });

  it("should format kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("should format megabytes correctly", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });

  it("should format gigabytes correctly", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
    expect(formatBytes(1610612736)).toBe("1.5 GB");
  });

  it("should format terabytes correctly", () => {
    expect(formatBytes(1099511627776)).toBe("1 TB");
  });
});

describe("formatSpeed", () => {
  it("should format speed as bytes per second with /s suffix", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(1024)).toBe("1 KB/s");
    expect(formatSpeed(1048576)).toBe("1 MB/s");
  });
});

describe("formatETA", () => {
  it('should return "∞" for 0 or negative seconds', () => {
    expect(formatETA(0)).toBe("∞");
    expect(formatETA(-1)).toBe("∞");
    expect(formatETA(-100)).toBe("∞");
  });

  it("should format minutes correctly", () => {
    expect(formatETA(60)).toBe("1m");
    expect(formatETA(120)).toBe("2m");
    expect(formatETA(90)).toBe("1m"); // 90 seconds = 1 minute (floor)
  });

  it("should format hours and minutes correctly", () => {
    expect(formatETA(3600)).toBe("1h 0m");
    expect(formatETA(3660)).toBe("1h 1m");
    expect(formatETA(7200)).toBe("2h 0m");
    expect(formatETA(5400)).toBe("1h 30m");
  });
});

describe("getStatusColor", () => {
  it("should return correct color for downloading status", () => {
    expect(getStatusColor("downloading")).toBe("bg-blue-500");
  });

  it("should return correct color for seeding status", () => {
    expect(getStatusColor("seeding")).toBe("bg-green-500");
  });

  it("should return correct color for completed status", () => {
    expect(getStatusColor("completed")).toBe("bg-green-600");
  });

  it("should return correct color for paused status", () => {
    expect(getStatusColor("paused")).toBe("bg-yellow-500");
  });

  it("should return correct color for error status", () => {
    expect(getStatusColor("error")).toBe("bg-red-500");
  });

  it("should return gray for unknown status", () => {
    expect(getStatusColor("unknown" as DownloadStatusType)).toBe("bg-gray-500");
  });
});

describe("getStatusBadgeVariant", () => {
  it('should return "default" for downloading status', () => {
    expect(getStatusBadgeVariant("downloading")).toBe("default");
  });

  it('should return "default" for seeding status', () => {
    expect(getStatusBadgeVariant("seeding")).toBe("default");
  });

  it('should return "outline" for completed status', () => {
    expect(getStatusBadgeVariant("completed")).toBe("outline");
  });

  it('should return "secondary" for paused status', () => {
    expect(getStatusBadgeVariant("paused")).toBe("secondary");
  });

  it('should return "destructive" for error status', () => {
    expect(getStatusBadgeVariant("error")).toBe("destructive");
  });

  it('should return "outline" for unknown status', () => {
    expect(getStatusBadgeVariant("unknown" as DownloadStatusType)).toBe("outline");
  });
});

describe("filterDownloadsByStatus", () => {
  const mockDownloads: DownloadData[] = [
    {
      id: "1",
      name: "Game 1",
      status: "downloading",
      progress: 50,
      downloadSpeed: 1000,
      downloaderId: "d1",
      downloaderName: "Downloader 1",
    },
    {
      id: "2",
      name: "Game 2",
      status: "seeding",
      progress: 100,
      uploadSpeed: 500,
      downloaderId: "d1",
      downloaderName: "Downloader 1",
    },
    {
      id: "3",
      name: "Game 3",
      status: "completed",
      progress: 100,
      ratio: 1.5,
      downloaderId: "d2",
      downloaderName: "Downloader 2",
    },
    {
      id: "4",
      name: "Game 4",
      status: "paused",
      progress: 25,
      downloaderId: "d1",
      downloaderName: "Downloader 1",
    },
    {
      id: "5",
      name: "Game 5",
      status: "error",
      progress: 10,
      error: "Connection failed",
      downloaderId: "d2",
      downloaderName: "Downloader 2",
    },
  ];

  it('should return all downloads when filter is "all"', () => {
    const result = filterDownloadsByStatus(mockDownloads, "all");
    expect(result).toHaveLength(5);
    expect(result).toEqual(mockDownloads);
  });

  it('should filter downloads by "downloading" status', () => {
    const result = filterDownloadsByStatus(mockDownloads, "downloading");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
    expect(result[0].status).toBe("downloading");
  });

  it('should filter downloads by "seeding" status', () => {
    const result = filterDownloadsByStatus(mockDownloads, "seeding");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
    expect(result[0].status).toBe("seeding");
  });

  it('should filter downloads by "completed" status', () => {
    const result = filterDownloadsByStatus(mockDownloads, "completed");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
    expect(result[0].status).toBe("completed");
  });

  it('should filter downloads by "paused" status', () => {
    const result = filterDownloadsByStatus(mockDownloads, "paused");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("4");
    expect(result[0].status).toBe("paused");
  });

  it('should filter downloads by "error" status', () => {
    const result = filterDownloadsByStatus(mockDownloads, "error");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("5");
    expect(result[0].status).toBe("error");
  });

  it("should return empty array when no downloads match the filter", () => {
    const downloadsWithoutErrors = mockDownloads.filter((d) => d.status !== "error");
    const result = filterDownloadsByStatus(downloadsWithoutErrors, "error");
    expect(result).toHaveLength(0);
  });

  it("should handle empty downloads array", () => {
    const result = filterDownloadsByStatus([], "completed");
    expect(result).toHaveLength(0);
  });
});

describe("shouldShowSpeedBadge", () => {
  it("should return true when speed is defined and greater than 0", () => {
    expect(shouldShowSpeedBadge(100)).toBe(true);
    expect(shouldShowSpeedBadge(1)).toBe(true);
    expect(shouldShowSpeedBadge(1000000)).toBe(true);
  });

  it("should return false when speed is 0", () => {
    expect(shouldShowSpeedBadge(0)).toBe(false);
  });

  it("should return false when speed is undefined", () => {
    expect(shouldShowSpeedBadge(undefined)).toBe(false);
  });

  it("should return false when speed is negative", () => {
    expect(shouldShowSpeedBadge(-1)).toBe(false);
    expect(shouldShowSpeedBadge(-100)).toBe(false);
  });
});

describe("shouldShowETABadge", () => {
  it("should return true when ETA is defined and greater than 0", () => {
    expect(shouldShowETABadge(60)).toBe(true);
    expect(shouldShowETABadge(1)).toBe(true);
    expect(shouldShowETABadge(3600)).toBe(true);
  });

  it("should return false when ETA is 0", () => {
    expect(shouldShowETABadge(0)).toBe(false);
  });

  it("should return false when ETA is undefined", () => {
    expect(shouldShowETABadge(undefined)).toBe(false);
  });

  it("should return false when ETA is negative (infinity case)", () => {
    expect(shouldShowETABadge(-1)).toBe(false);
  });
});

describe("shouldShowRatioBadge", () => {
  it("should return true when ratio is defined and >= 0", () => {
    expect(shouldShowRatioBadge(0)).toBe(true);
    expect(shouldShowRatioBadge(0.5)).toBe(true);
    expect(shouldShowRatioBadge(1)).toBe(true);
    expect(shouldShowRatioBadge(2.5)).toBe(true);
  });

  it("should return false when ratio is undefined", () => {
    expect(shouldShowRatioBadge(undefined)).toBe(false);
  });

  it("should return false when ratio is negative", () => {
    expect(shouldShowRatioBadge(-0.1)).toBe(false);
    expect(shouldShowRatioBadge(-1)).toBe(false);
  });
});

describe("shouldShowSizeBadge", () => {
  it("should return true when size is defined and greater than 0", () => {
    expect(shouldShowSizeBadge(100)).toBe(true);
    expect(shouldShowSizeBadge(1)).toBe(true);
    expect(shouldShowSizeBadge(1073741824)).toBe(true); // 1 GB
  });

  it("should return false when size is 0", () => {
    expect(shouldShowSizeBadge(0)).toBe(false);
  });

  it("should return false when size is undefined", () => {
    expect(shouldShowSizeBadge(undefined)).toBe(false);
  });

  it("should return false when size is negative", () => {
    expect(shouldShowSizeBadge(-1)).toBe(false);
  });
});

describe("shouldShowPeersBadge", () => {
  it("should return true when seeders is defined (even if 0)", () => {
    expect(shouldShowPeersBadge(0)).toBe(true);
    expect(shouldShowPeersBadge(5)).toBe(true);
    expect(shouldShowPeersBadge(100)).toBe(true);
  });

  it("should return false when seeders is undefined", () => {
    expect(shouldShowPeersBadge(undefined)).toBe(false);
  });
});

describe("Badge visibility edge cases", () => {
  it("should handle download with all data present", () => {
    const download: DownloadData = {
      id: "1",
      name: "Test Download",
      status: "downloading",
      progress: 50,
      downloadSpeed: 1000,
      uploadSpeed: 500,
      eta: 3600,
      size: 1073741824,
      downloaded: 536870912,
      seeders: 10,
      leechers: 5,
      ratio: 0.5,
      downloaderId: "d1",
      downloaderName: "Test Downloader",
    };

    expect(shouldShowSpeedBadge(download.downloadSpeed)).toBe(true);
    expect(shouldShowSpeedBadge(download.uploadSpeed)).toBe(true);
    expect(shouldShowETABadge(download.eta)).toBe(true);
    expect(shouldShowSizeBadge(download.size)).toBe(true);
    expect(shouldShowPeersBadge(download.seeders)).toBe(true);
    expect(shouldShowRatioBadge(download.ratio)).toBe(true);
  });

  it("should handle download with minimal data (no optional fields)", () => {
    const download: DownloadData = {
      id: "1",
      name: "Test Download",
      status: "completed",
      progress: 100,
      downloaderId: "d1",
      downloaderName: "Test Downloader",
    };

    expect(shouldShowSpeedBadge(download.downloadSpeed)).toBe(false);
    expect(shouldShowSpeedBadge(download.uploadSpeed)).toBe(false);
    expect(shouldShowETABadge(download.eta)).toBe(false);
    expect(shouldShowSizeBadge(download.size)).toBe(false);
    expect(shouldShowPeersBadge(download.seeders)).toBe(false);
    expect(shouldShowRatioBadge(download.ratio)).toBe(false);
  });

  it("should handle completed download with ratio but no speeds", () => {
    const download: DownloadData = {
      id: "1",
      name: "Test Download",
      status: "completed",
      progress: 100,
      downloadSpeed: 0,
      uploadSpeed: 0,
      ratio: 2.5,
      downloaderId: "d1",
      downloaderName: "Test Downloader",
    };

    expect(shouldShowSpeedBadge(download.downloadSpeed)).toBe(false);
    expect(shouldShowSpeedBadge(download.uploadSpeed)).toBe(false);
    expect(shouldShowRatioBadge(download.ratio)).toBe(true);
  });
});

describe("Usenet Utility Functions", () => {
  describe("getDownloadTypeColor", () => {
    it("should return correct color for usenet", () => {
      const color = getDownloadTypeColor("usenet");
      expect(color).toContain("bg-amber-600");
    });

    it("should return correct color for torrent", () => {
      const color = getDownloadTypeColor("torrent");
      expect(color).toContain("bg-violet-600");
    });

    it("should return default color (torrent) when undefined", () => {
      const color = getDownloadTypeColor(undefined);
      expect(color).toContain("bg-violet-600");
    });
  });

  describe("getDownloadTypeBadgeVariant", () => {
    it("should return secondary for usenet", () => {
      expect(getDownloadTypeBadgeVariant("usenet")).toBe("secondary");
    });

    it("should return default for torrent", () => {
      expect(getDownloadTypeBadgeVariant("torrent")).toBe("default");
    });

    it("should return default when undefined", () => {
      expect(getDownloadTypeBadgeVariant(undefined)).toBe("default");
    });
  });

  describe("getDownloadTypeTextExColor", () => {
    it("should return amber text for usenet", () => {
      expect(getDownloadTypeTextExColor("usenet")).toContain("text-amber-600");
    });

    it("should return violet text for torrent", () => {
      expect(getDownloadTypeTextExColor("torrent")).toContain("text-violet-600");
    });

    it("should return violet text when undefined", () => {
      expect(getDownloadTypeTextExColor(undefined)).toContain("text-violet-600");
    });
  });

  describe("formatDownloadType", () => {
    it("should return Usenet for usenet type", () => {
      expect(formatDownloadType("usenet")).toBe("Usenet");
    });

    it("should return Torrent for torrent type", () => {
      expect(formatDownloadType("torrent")).toBe("Torrent");
    });

    it("should return Torrent when undefined", () => {
      expect(formatDownloadType(undefined)).toBe("Torrent");
    });
  });

  describe("shouldShowTorrentMetrics", () => {
    it("should return true for torrent type", () => {
      const download = { downloadType: "torrent" } as DownloadData;
      expect(shouldShowTorrentMetrics(download)).toBe(true);
    });

    it("should return true when type is undefined (backward compatibility)", () => {
      const download = {} as DownloadData;
      expect(shouldShowTorrentMetrics(download)).toBe(true);
    });

    it("should return false for usenet type", () => {
      const download = { downloadType: "usenet" } as DownloadData;
      expect(shouldShowTorrentMetrics(download)).toBe(false);
    });
  });

  describe("shouldShowUsenetMetrics", () => {
    it("should return true for usenet type", () => {
      const download = { downloadType: "usenet" } as DownloadData;
      expect(shouldShowUsenetMetrics(download)).toBe(true);
    });

    it("should return false for torrent type", () => {
      const download = { downloadType: "torrent" } as DownloadData;
      expect(shouldShowUsenetMetrics(download)).toBe(false);
    });
  });

  describe("shouldShowRepairStatus", () => {
    it("should return true for usenet with repair status", () => {
      const download = { downloadType: "usenet", repairStatus: "repairing" } as DownloadData;
      expect(shouldShowRepairStatus(download)).toBe(true);
    });

    it("should return false if not usenet", () => {
      const download = { downloadType: "torrent", repairStatus: "repairing" } as DownloadData;
      expect(shouldShowRepairStatus(download)).toBe(false);
    });

    it("should return false if repair status is undefined", () => {
      const download = { downloadType: "usenet" } as DownloadData;
      expect(shouldShowRepairStatus(download)).toBe(false);
    });
  });

  describe("shouldShowUnpackStatus", () => {
    it("should return true for usenet with unpack status", () => {
      const download = { downloadType: "usenet", unpackStatus: "unpacking" } as DownloadData;
      expect(shouldShowUnpackStatus(download)).toBe(true);
    });

    it("should return false if not usenet", () => {
      const download = { downloadType: "torrent", unpackStatus: "unpacking" } as DownloadData;
      expect(shouldShowUnpackStatus(download)).toBe(false);
    });

    it("should return false if unpack status is undefined", () => {
      const download = { downloadType: "usenet" } as DownloadData;
      expect(shouldShowUnpackStatus(download)).toBe(false);
    });
  });

  describe("getRepairStatusBadgeVariant", () => {
    it("should return correct variants", () => {
      expect(getRepairStatusBadgeVariant("good")).toBe("outline");
      expect(getRepairStatusBadgeVariant("repairing")).toBe("default");
      expect(getRepairStatusBadgeVariant("failed")).toBe("destructive");
      expect(getRepairStatusBadgeVariant(undefined)).toBe("outline");
    });
  });

  describe("getUnpackStatusBadgeVariant", () => {
    it("should return correct variants", () => {
      expect(getUnpackStatusBadgeVariant("completed")).toBe("outline");
      expect(getUnpackStatusBadgeVariant("unpacking")).toBe("default");
      expect(getUnpackStatusBadgeVariant("failed")).toBe("destructive");
      expect(getUnpackStatusBadgeVariant(undefined)).toBe("outline");
    });
  });

  describe("formatRepairStatus", () => {
    it("should format correctly", () => {
      expect(formatRepairStatus("good")).toBe("Repair OK");
      expect(formatRepairStatus("repairing")).toBe("Repairing...");
      expect(formatRepairStatus("failed")).toBe("Repair Failed");
      expect(formatRepairStatus(undefined)).toBe("Unknown");
    });
  });

  describe("formatUnpackStatus", () => {
    it("should format correctly", () => {
      expect(formatUnpackStatus("completed")).toBe("Unpacked");
      expect(formatUnpackStatus("unpacking")).toBe("Unpacking...");
      expect(formatUnpackStatus("failed")).toBe("Unpack Failed");
      expect(formatUnpackStatus(undefined)).toBe("Unknown");
    });
  });

  describe("formatAge", () => {
    it("should handle undefined", () => {
      expect(formatAge(undefined)).toBe("");
    });
    it("should handle 0 days", () => {
      expect(formatAge(0)).toBe("Today");
    });
    it("should handle partial days", () => {
      expect(formatAge(0.5)).toBe("< 1 day");
    });
    it("should handle 1 day", () => {
      expect(formatAge(1)).toBe("1 day");
    });
    it("should handle multiple days", () => {
      expect(formatAge(5)).toBe("5 days");
    });
  });

  describe("isUsenetItem", () => {
    it("should identify usenet item by grabs", () => {
      expect(isUsenetItem({ grabs: 10 })).toBe(true);
    });
    it("should identify usenet item by age", () => {
      expect(isUsenetItem({ age: 10 })).toBe(true);
    });
    it("should return false if seeders are present (torrent)", () => {
      expect(isUsenetItem({ seeders: 10, grabs: 5 })).toBe(false);
    });
    it("should return false if no identifying fields", () => {
      expect(isUsenetItem({})).toBe(false);
    });
  });
});
