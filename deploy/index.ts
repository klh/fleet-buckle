// deploy barrel — consumers resolve compose + settings by package name.
export const composeUnit = "deploy/compose.yaml";
export const composeTest = "test/deploy/compose.test.yaml";
export const settings = {
  default: "deploy/settings/default.settings.json5",
  b1: "deploy/settings/b1.settings.json5",
  b2: "test/deploy/settings/b2.settings.json5",
  b3: "test/deploy/settings/b3.settings.json5",
} as const;
