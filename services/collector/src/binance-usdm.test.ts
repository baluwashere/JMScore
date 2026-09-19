import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBinanceUsdmUrls } from './binance-usdm.js';

test('buildBinanceUsdmUrls uses the 2026 routed Binance endpoints', () => {
  const urls = buildBinanceUsdmUrls('BTCUSDT');

  assert.equal(
    urls.publicUrl,
    'wss://fstream.binance.com/public/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms/btcusdt@bookTicker',
  );
  assert.equal(
    urls.marketUrl,
    'wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s',
  );
  assert.equal(
    urls.openInterestUrl,
    'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
  );
});
