import { describe, expect, it } from "vitest";
import { PicnicAuthError, isPicnicAuthFailure } from "../src/grocery/auth";
import { normalizePicnicProduct } from "../src/grocery/normalize";

describe("isPicnicAuthFailure", () => {
  it("flags 403, 2FA and authorization errors", () => {
    expect(isPicnicAuthFailure("Error: 403 Forbidden")).toBe(true);
    expect(isPicnicAuthFailure("Picnic client logged in, but 2FA is required.")).toBe(true);
    expect(isPicnicAuthFailure("second_factor_authentication_required")).toBe(true);
    expect(isPicnicAuthFailure("Unauthorized")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isPicnicAuthFailure("Product not found")).toBe(false);
    expect(isPicnicAuthFailure("")).toBe(false);
  });

  it("names the auth error", () => {
    expect(new PicnicAuthError("x").name).toBe("PicnicAuthError");
  });
});

describe("normalizePicnicProduct", () => {
  it("converts cents to euros and parses the package size from unit", () => {
    expect(
      normalizePicnicProduct({ id: "p1", name: "Basmatireis", price: 249, unit: "500 g" }),
    ).toEqual({
      productId: "p1",
      name: "Basmatireis",
      price: 2.49,
      unitAmount: 500,
      unitAmountUnit: "gram",
      onDeal: false,
    });
  });

  it("parses gr/kg units and falls back to the name", () => {
    expect(normalizePicnicProduct({ id: "p2", name: "Mehl", price: 99, unit: "500 gr" })).toEqual({
      productId: "p2",
      name: "Mehl",
      price: 0.99,
      unitAmount: 500,
      unitAmountUnit: "gram",
      onDeal: false,
    });
    expect(normalizePicnicProduct({ id: "p3", name: "Eier 6 Stk", price: 199, unit: "" })?.unitAmount).toBe(6);
    expect(normalizePicnicProduct({ id: "p4", name: "Zucker", price: 129, unit: "1 kg" })?.price).toBe(1.29);
  });

  it("returns null for entries without id/name/price", () => {
    expect(normalizePicnicProduct({ name: "x", price: 1 })).toBeNull();
    expect(normalizePicnicProduct(null)).toBeNull();
  });
});
