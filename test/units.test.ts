import { describe, expect, it } from "vitest";
import { convertClovesToPieces, isCountable, isUnit, normalizeUnit } from "../src/units";

describe("units", () => {
  it("accepts only known units", () => {
    expect(isUnit("gram")).toBe(true);
    expect(isUnit("ounce")).toBe(false);
    expect(isUnit(42)).toBe(false);
  });

  it("normalizes common German and English unit aliases", () => {
    expect(normalizeUnit("gramm")).toBe("gram");
    expect(normalizeUnit("g")).toBe("gram");
    expect(normalizeUnit("EL")).toBe("ml");
    expect(normalizeUnit("Teelöffel")).toBe("ml");
    expect(normalizeUnit("Zehe")).toBe("clove");
    expect(normalizeUnit("Stück")).toBe("piece");
    expect(normalizeUnit("Packung")).toBe("package");
    expect(normalizeUnit("  ML  ")).toBe("ml");
  });

  it("keeps canonical units and passes unknown values through", () => {
    expect(normalizeUnit("clove")).toBe("clove");
    expect(normalizeUnit("handvoll")).toBe("handvoll");
    expect(normalizeUnit(42)).toBe(42);
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
