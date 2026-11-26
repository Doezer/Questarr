import { describe, expect, it } from "vitest";
import { titleKeys } from "../achievement-matching.js";

describe("titleKeys", () => {
  it("keeps letters of every script", () => {
    expect(titleKeys("大神")).toEqual(["大神"]);
    expect(titleKeys("Pokémon")).toEqual(titleKeys("Pokemon"));
  });

  it("drops region and disc markers but keeps edition labels", () => {
    expect(titleKeys("Sonic (USA, Europe)")).toEqual(["sonic"]);
    expect(titleKeys("Game (Disc 1)")).toEqual(["game"]);
    expect(titleKeys("Game (Classic)")).not.toEqual(titleKeys("Game (Remake)"));
    expect(titleKeys("Game (Remake)")).not.toEqual(titleKeys("Game"));
  });

  it("treats a list of language codes as a release marker", () => {
    expect(titleKeys("Game (Europe) (En,Da)")).toEqual(titleKeys("Game"));
    expect(titleKeys("Game (No,Fi,Pl)")).toEqual(["game"]);
  });

  it("splits alternative names and strips trademark signs", () => {
    expect(titleKeys("Doom™ | Doom 2016")).toEqual(["doom", "doom 2016"]);
  });
});
