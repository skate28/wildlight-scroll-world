import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureTestnetAddressFunded } from '../src/testnet-faucet.js';

const ADDRESS = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

function accountInfo(balance = '100000000') {
  return {
    result: {
      account_data: {
        Account: ADDRESS,
        Balance: balance,
      },
    },
  };
}

function accountNotFound() {
  return Object.assign(new Error('Account not found'), {
    data: { error: 'actNotFound' },
  });
}

test('leaves an existing Testnet account unchanged', async () => {
  let fetchCalled = false;
  const client = {
    request: async () => accountInfo('75000000'),
  };

  const result = await ensureTestnetAddressFunded({
    client,
    address: ADDRESS,
    faucetUrl: 'https://faucet.example/accounts',
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('The faucet should not be called.');
    },
  });

  assert.equal(result.funded, false);
  assert.equal(result.accountInfo.result.account_data.Balance, '75000000');
  assert.equal(fetchCalled, false);
});

test('funds the same newly created address with 100 test XRP', async () => {
  let ledgerRequests = 0;
  let fundingStarted = false;
  let faucetRequest;
  const client = {
    request: async () => {
      ledgerRequests += 1;
      if (ledgerRequests === 1) throw accountNotFound();
      return accountInfo();
    },
  };

  const result = await ensureTestnetAddressFunded({
    client,
    address: ADDRESS,
    faucetUrl: 'https://faucet.example/accounts',
    onFunding: () => {
      fundingStarted = true;
    },
    fetchImpl: async (url, options) => {
      faucetRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ account: { classicAddress: ADDRESS } }),
      };
    },
  });

  assert.equal(result.funded, true);
  assert.equal(result.accountInfo.result.account_data.Balance, '100000000');
  assert.equal(fundingStarted, true);
  assert.equal(faucetRequest.url, 'https://faucet.example/accounts');
  assert.deepEqual(JSON.parse(faucetRequest.options.body), {
    destination: ADDRESS,
    xrpAmount: '100',
    usageContext: 'wildlight-scroll-world',
  });
});

test('surfaces Testnet faucet errors', async () => {
  const client = {
    request: async () => {
      throw accountNotFound();
    },
  };

  await assert.rejects(
    ensureTestnetAddressFunded({
      client,
      address: ADDRESS,
      faucetUrl: 'https://faucet.example/accounts',
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Faucet is busy.' }),
      }),
    }),
    /Faucet is busy/,
  );
});
