/**
 * Unit tests only — they run with no database and no network, so `npm test` is safe to
 * run on a fresh clone before `docker-compose up`. The integration tests that need
 * Postgres live under test/ and run via `npm run test:e2e`.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};
