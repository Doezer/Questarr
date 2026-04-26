import { describe, expect, it } from "vitest";
import { truncateLogData } from "../logging-utils.js";

describe("truncateLogData", () => {
  it("keeps file browser item fields explicit in logged responses", () => {
    const truncated = truncateLogData({
      path: "/",
      parent: null,
      items: [
        {
          name: "games",
          path: "/games",
          isDirectory: true,
          size: 0,
        },
      ],
    }) as {
      items: Array<{
        name: unknown;
        path: unknown;
        isDirectory: unknown;
        size: unknown;
      }>;
    };

    expect(truncated.items[0]).toEqual({
      name: "games",
      path: "/games",
      isDirectory: true,
      size: 0,
    });
  });

  it("still truncates deeper nested structures", () => {
    const truncated = truncateLogData({
      a: {
        b: {
          c: {
            d: "value",
          },
        },
      },
    });

    expect(truncated).toEqual({
      a: {
        b: {
          c: {
            d: "[Object/Array]",
          },
        },
      },
    });
  });
});
