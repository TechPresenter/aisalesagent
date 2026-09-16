/**
 * Unit tests for the browser-side logic that is worth testing directly: date arithmetic,
 * formatting, filter translation — the pure functions under lib/. Components are not
 * covered here; they are exercised against the real API by the smoke scripts in apps/api,
 * which is where a rendering bug would actually show up.
 *
 * `testEnvironment: node` because none of these touch the DOM.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts", "tsx"],
  rootDir: ".",
  testRegex: ".*\.spec\.ts$",
  transform: { "^.+\.(t|j)sx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  testEnvironment: "node",
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};
