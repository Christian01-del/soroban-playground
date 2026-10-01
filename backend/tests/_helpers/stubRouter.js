const express = require('express');

function stubRouter() {
  const router = express.Router();
  const handler = (_req, res) => res.json({ success: true, data: { stub: true } });
  router.get('/', handler);
  router.get('/*', handler);
  router.post('/', handler);
  router.post('/*', handler);
  return router;
}

module.exports = { __esModule: true, default: stubRouter() };
