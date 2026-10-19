/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";

import GameVideoCard from "../src/components/GameVideoCard";
import GameVideoCarousel from "../src/components/GameVideoCarousel";

const videos = [
  { name: "Official Trailer", videoId: "dQw4w9WgXcQ" },
  { name: "Gameplay Reveal", videoId: "abc_DEF-123" },
];

describe("GameVideoCard", () => {
  it("shows the thumbnail and calls onPlay without loading the embed", () => {
    let played = 0;
    render(
      <GameVideoCard name="Trailer" videoId="dQw4w9WgXcQ" playing={false} onPlay={() => played++} />
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
    fireEvent.click(screen.getByRole("button", { name: "Play video: Trailer" }));
    expect(played).toBe(1);
  });

  it("renders the privacy-enhanced embed when playing", () => {
    render(<GameVideoCard name="Trailer" videoId="dQw4w9WgXcQ" playing onPlay={() => {}} />);
    expect(document.querySelector("iframe")).toHaveAttribute(
      "src",
      expect.stringContaining("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
    );
  });
});

describe("GameVideoCarousel", () => {
  it("lists the videos with a counter and navigation for several videos", () => {
    render(<GameVideoCarousel videos={videos} />);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous video" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play video: Official Trailer" })
    ).toBeInTheDocument();
  });

  it("hides the navigation for a single video and plays it in place", () => {
    render(<GameVideoCarousel videos={videos.slice(0, 1)} />);
    expect(screen.queryByRole("button", { name: "Next video" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play video: Official Trailer" }));
    expect(document.querySelector("iframe")).not.toBeNull();
  });
});
