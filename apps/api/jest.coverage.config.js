/** Combined unit + e2e coverage (requires local infra: npm run infra:up). */
const unit = require('./jest.config.js');
const e2e = require('./test/jest-e2e.config.js');
module.exports = {
  projects: [
    { ...unit, displayName: 'unit', collectCoverageFrom: undefined, coverageDirectory: undefined },
    { ...e2e, displayName: 'e2e', rootDir: __dirname },
  ],
  collectCoverageFrom: unit.collectCoverageFrom,
  coverageDirectory: 'coverage',
  // testTimeout is a global option: per-project values are ignored in a multi-project run.
  testTimeout: 60000,
  coverageReporters: ['text-summary', 'json-summary', 'text'],
};
