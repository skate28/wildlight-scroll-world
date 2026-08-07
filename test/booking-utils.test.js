import assert from 'node:assert/strict';
import test from 'node:test';
import { convertHexToString } from 'xrpl';
import {
  BOOKING_MEMO_TYPE,
  RECEIPT_TAXON,
  buildEscrowAction,
  buildEscrowCreate,
  buildReceiptMint,
  createStayWindow,
  parseEscrowTransaction,
} from '../src/booking-utils.js';

const ACCOUNT = 'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn';
const DESTINATION = 'rJAz9M9KnQ8pzSSzcVgXdm3V9AEJhrbe5L';
const HASH = 'A'.repeat(64);

test('builds a 50 XRP time escrow with a post-checkout refund', () => {
  const { transaction, stay } = buildEscrowCreate({
    account: ACCOUNT,
    destination: DESTINATION,
    checkIn: '2030-04-10',
    amountXrp: '50',
    nights: 3,
    refundGraceDays: 1,
  });

  assert.equal(transaction.TransactionType, 'EscrowCreate');
  assert.equal(transaction.Account, ACCOUNT);
  assert.equal(transaction.Destination, DESTINATION);
  assert.equal(transaction.Amount, '50000000');
  assert.equal(transaction.FinishAfter, stay.finishAfter);
  assert.equal(transaction.CancelAfter, stay.cancelAfter);
  assert.equal(stay.cancelAfter - stay.finishAfter, 4 * 24 * 60 * 60);
  assert.equal(convertHexToString(transaction.Memos[0].Memo.MemoType), BOOKING_MEMO_TYPE);

  const memo = JSON.parse(convertHexToString(transaction.Memos[0].Memo.MemoData));
  assert.deepEqual(memo, {
    v: 1,
    stay: 'wildlight-city-loft',
    checkIn: '2030-04-10',
    nights: 3,
    asset: 'XRP',
  });
});

test('uses 15:00 UTC for release and one grace day after checkout', () => {
  const stay = createStayWindow('2030-12-30', 3, 1);

  assert.equal(stay.finishAt.toISOString(), '2030-12-30T15:00:00.000Z');
  assert.equal(stay.checkOutAt.toISOString(), '2031-01-02T11:00:00.000Z');
  assert.equal(stay.cancelAt.toISOString(), '2031-01-03T15:00:00.000Z');
});

test('builds an NFT receipt linked to the escrow hash', () => {
  const transaction = buildReceiptMint({
    account: ACCOUNT,
    escrowHash: HASH,
    receiptUrl: 'https://wildlight.example/',
  });

  assert.equal(transaction.TransactionType, 'NFTokenMint');
  assert.equal(transaction.Account, ACCOUNT);
  assert.equal(transaction.NFTokenTaxon, RECEIPT_TAXON);
  assert.equal(
    convertHexToString(transaction.URI),
    `https://wildlight.example/?receipt=${HASH}`,
  );
});

test('parses a validated Wildlight escrow transaction', () => {
  const parsed = parseEscrowTransaction({
    validated: true,
    hash: HASH,
    tx_json: {
      TransactionType: 'EscrowCreate',
      Account: ACCOUNT,
      Destination: DESTINATION,
      Amount: '50000000',
      Sequence: 42,
      FinishAfter: 950000000,
      CancelAfter: 950345600,
    },
    meta: { TransactionResult: 'tesSUCCESS' },
  });

  assert.equal(parsed.hash, HASH);
  assert.equal(parsed.owner, ACCOUNT);
  assert.equal(parsed.offerSequence, 42);
  assert.equal(parsed.amountXrp, '50');
});

test('builds finish and cancel transactions using the escrow sequence', () => {
  assert.deepEqual(
    buildEscrowAction({
      action: 'finish',
      account: ACCOUNT,
      owner: ACCOUNT,
      offerSequence: 42,
    }),
    {
      TransactionType: 'EscrowFinish',
      Account: ACCOUNT,
      Owner: ACCOUNT,
      OfferSequence: 42,
    },
  );

  assert.equal(
    buildEscrowAction({
      action: 'cancel',
      account: ACCOUNT,
      owner: ACCOUNT,
      offerSequence: 42,
    }).TransactionType,
    'EscrowCancel',
  );
});

test('rejects malformed dates and receipt hashes', () => {
  assert.throws(() => createStayWindow('2030-02-30'), /valid calendar date/);
  assert.throws(
    () =>
      buildReceiptMint({
        account: ACCOUNT,
        escrowHash: 'not-a-hash',
        receiptUrl: 'https://wildlight.example',
      }),
    /64 hexadecimal/,
  );
});
