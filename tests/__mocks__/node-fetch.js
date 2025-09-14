// Mock for node-fetch to work with Jest in CommonJS mode
module.exports = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: jest.fn(() => Promise.resolve({})),
    text: jest.fn(() => Promise.resolve('')),
    headers: new Map(),
  })
);

module.exports.default = module.exports;
module.exports.RequestInit = {};