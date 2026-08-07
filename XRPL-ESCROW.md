# Wildlight XRPL booking hold

The final frame of the Wildlight flight reveals a non-custodial XRPL booking flow:

1. Connect an XRPL wallet.
2. Select a check-in date.
3. Sign an `EscrowCreate` for 50 XRP.
4. Wait for a validated ledger.
5. Optionally sign an `NFTokenMint` receipt linked to the escrow transaction.
6. After check-in, use the escrow desk to submit `EscrowFinish`.
7. If the deposit remains unclaimed through checkout plus one day, submit
   `EscrowCancel` to return it to the sender.

The browser never receives a wallet seed. Signing and submission stay inside the
selected wallet.

## Local development

```sh
npm install
npm run check
npx netlify dev
```

The default build is an XRPL Testnet demonstration. Obtain valueless test XRP from
the [XRPL faucet](https://xrpl.org/resources/dev-tools/xrp-faucets).

Wallets that do not require application credentials are available by default:
Crossmark, GemWallet, Xyra, and Otsu. To add Xaman, create an application at
<https://apps.xumm.dev> and set its public API key:

```sh
netlify env:set XRPL_XAMAN_API_KEY your-public-api-key
```

## Build-time configuration

- `XRPL_NETWORK`: defaults to `testnet`; accepts `testnet` or `mainnet`.
- `XRPL_ESCROW_DESTINATION`: defaults to the funded Wildlight Testnet demo
  address and identifies the escrow recipient.
- `XRPL_XAMAN_API_KEY`: empty by default; enables the Xaman adapter when set.
- `WILDLIGHT_ENABLE_MAINNET`: empty by default; must be exactly `true` before a
  Mainnet build.

The Mainnet safety flag is intentional. Before accepting real funds, replace the
demo recipient, review cancellation policy and regulatory obligations, test every
supported wallet, and add booking inventory on a proper backend.

## Why the demo uses XRP, not RLUSD

XRPL's `TokenEscrow` amendment supports trust-line tokens, but the token issuer must
enable `Allow Trust Line Locking`. As checked on August 7, 2026, the official RLUSD
issuers on both Testnet and Mainnet report `allowTrustLineLocking: false`, so an
RLUSD `EscrowCreate` would fail with `tecNO_PERMISSION`.

The flow therefore uses 50 XRP and keeps the asset boundary isolated for a later
RLUSD upgrade if the issuer enables token locking.
