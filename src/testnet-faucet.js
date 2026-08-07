function isAccountNotFound(error) {
  return String(error?.data?.error || error?.message || '').includes('actNotFound');
}

export async function readAccountInfo(client, address) {
  try {
    return await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
      strict: true,
    });
  } catch (error) {
    if (isAccountNotFound(error)) return null;
    throw error;
  }
}

export async function ensureTestnetAddressFunded({
  client,
  address,
  faucetUrl,
  amountXrp = '100',
  usageContext = 'wildlight-scroll-world',
  fetchImpl = globalThis.fetch,
  onFunding,
  timeoutMs = 45000,
  pollIntervalMs = 1500,
}) {
  const existing = await readAccountInfo(client, address);
  if (existing) return { funded: false, accountInfo: existing };

  onFunding?.();
  const response = await fetchImpl(faucetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: address,
      xrpAmount: String(amountXrp),
      usageContext,
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Testnet faucet returned ${response.status}.`);
  }
  if (payload?.account?.classicAddress && payload.account.classicAddress !== address) {
    throw new Error('Testnet faucet funded an unexpected address.');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const accountInfo = await readAccountInfo(client, address);
    if (accountInfo) return { funded: true, accountInfo, faucet: payload };
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Automatic Testnet funding timed out.');
}
