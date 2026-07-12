// Lightweight ts-jest setup for pure logic modules (src/logic). This intentionally does
// NOT use jest-expo / the React Native preset — those pull in native transforms and a
// conflicting React peer. Component/native tests would need a separate preset.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
};
