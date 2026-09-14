import type { PackageAmount } from "../mapping/quantity";

export interface ProductCandidate {
  productId: string;
  name: string;
  price: number;
  unitAmount: number | null;
  unitAmountUnit: PackageAmount["unit"] | null;
  onDeal: boolean;
}

export interface GroceryClient {
  searchProducts(keyword: string, limit?: number): Promise<ProductCandidate[]>;
  addToCart(productId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}
