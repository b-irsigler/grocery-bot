import { describe, expect, it } from "vitest";
import { convertClovesToPieces, isCountable, isUnit } from "../src/units";

describe("units", () => {
  it("accepts only known units", () => {
    expect(isUnit("gram")).toBe(true);
    expect(isUnit("ounce")).toBe(false);
    expect(isUnit(42)).toBe(false);
  });

  it("marks countable units", () => {
    expect(isCountable("piece")).toBe(true);
    expect(isCountable("clove")).toBe(true);
    expect(isCountable("package")).toBe(true);
    expect(isCountable("gram")).toBe(false);
    expect(isCountable("ml")).toBe(false);
  });

  it("converts cloves to pieces", () => {
    expect(convertClovesToPieces(3, "clove")).toEqual({ quantity: 3, unit: "piece" });
    expect(convertClovesToPieces(500, "gram")).toEqual({ quantity: 500, unit: "gram" });
  });
});
