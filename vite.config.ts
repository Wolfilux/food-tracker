import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/food-search": {
        target: "https://search.openfoodfacts.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/food-search/, "/search"),
      },
    },
  },
});
