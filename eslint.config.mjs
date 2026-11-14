import tseslint from "typescript-eslint";

export default [
  {
    files: ["**/*.ts"],
    ignores: ["**/node_modules/**", "**/.worktrees/**"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-useless-catch": "error",
      "no-useless-rename": "error",
      "no-duplicate-imports": "error",
      "max-depth": ["warn", 3],
      "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-statements": ["warn", 25],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "test/**/*.ts"],
    rules: {
      "max-depth": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
    },
  },
];
