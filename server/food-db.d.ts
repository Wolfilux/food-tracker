import type { Connect } from "vite";

export function createFoodApiMiddleware(): Connect.NextHandleFunction;
export function searchFoods(query: string, limit?: number): Array<{
  id: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  source: string;
}>;
export function searchFoodsExpanded(query: string, limit?: number): Promise<Array<{
  id: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  imageUrl?: string;
  source: string;
}>>;
export function findFoodByBarcode(barcode: string): Promise<{
  id: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  imageUrl?: string;
  source: string;
} | null>;
export function getPublicAiConfig(): {
  provider: string;
  model: string;
  hasApiKey: boolean;
  keyHint: string;
  providers: Array<{
    id: string;
    label: string;
    models: string[];
  }>;
};
export function saveAiConfig(input: unknown): ReturnType<typeof getPublicAiConfig>;
