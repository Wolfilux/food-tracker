import assert from "node:assert/strict";

const ethanolDensityGPerMl = 0.789;
const ethanolCaloriesPerGram = 7;

function alcoholGrams(quantityMl, volPercent) {
  return Math.round(quantityMl * (volPercent / 100) * ethanolDensityGPerMl * 10) / 10;
}

function alcoholCalories(quantityMl, volPercent) {
  return Math.round(alcoholGrams(quantityMl, volPercent) * ethanolCaloriesPerGram);
}

const examples = [
  { name: "Bier 0,5l 5%", ml: 500, vol: 5, grams: 19.7, calories: 138 },
  { name: "Wein 0,2l 12%", ml: 200, vol: 12, grams: 18.9, calories: 132 },
  { name: "Spirituose 4cl 40%", ml: 40, vol: 40, grams: 12.6, calories: 88 },
];

for (const example of examples) {
  assert.equal(alcoholGrams(example.ml, example.vol), example.grams, `${example.name} ethanol grams`);
  assert.equal(alcoholCalories(example.ml, example.vol), example.calories, `${example.name} alcohol calories`);
}
