import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: ["*.js", "node_modules/**", "esbuild.config.mjs", "version-bump.mjs", "src/__tests__/**"],
  },
  {
    files: ["src/**/*.ts"],
    plugins: {
      obsidianmd,
    },
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      ...obsidianmd.configs.recommended,
    },
  }
);
