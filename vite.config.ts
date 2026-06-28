import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "food-tracker-sqlite-api",
      async configureServer(server) {
        const { createFoodApiMiddleware } = await import("./server/food-db.js");
        server.middlewares.use(createFoodApiMiddleware());
      },
    },
  ],
});
