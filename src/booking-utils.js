import {
  convertHexToString,
  convertStringToHex,
  dropsToXrp,
  isoTimeToRippleTime,
  rippleTimeToISOTime,
  xrpToDrops,
} from 'xrpl';

export const RECEIPT_TAXON = 0x57494c44; // "WILD"
export const BOOKING_MEMO_TYPE = 'wildlight.booking';
export const RECEIPT_MEMO_TYPE = 'wildlight.receipt';

function requireClassicAddress(value, field) {
  if (typeof value !== 'string' || !value.startsWith('r') || value.length < 25) {
    throw new TypeError(`${field} must be an XRPL classic address.`);
  }
  return value;
}

function requireHash(value) {
  const hash = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(hash)) {
    throw new TypeError('Transaction hash must be 64 hexadecimal characters.');
  }
  return hash;
}

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new TypeError('Check-in date must use YYYY-MM-DD.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError('Check-in date is not a valid calendar date.');
  }

  return date;
}

function addUtcDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function atUtcHour(date, hour) {
  const copy = new Date(date);
  copy.setUTCHours(hour, 0, 0, 0);
  return copy;
}

function memo(type, data) {
  return {
    Memo: {
      MemoType: convertStringToHex(type),
      MemoFormat: convertStringToHex('application/json'),
      MemoData: convertStringToHex(JSON.stringify(data)),
    },
  };
}

export function createStayWindow(checkIn, nights = 3, refundGraceDays = 1) {
  if (!Number.isInteger(nights) || nights < 1 || nights > 30) {
    throw new RangeError('Nights must be an integer from 1 to 30.');
  }
  if (!Number.isInteger(refundGraceDays) || refundGraceDays < 1 || refundGraceDays > 30) {
    throw new RangeError('Refund grace must be an integer from 1 to 30 days.');
  }

  const checkInDay = parseDateOnly(checkIn);
  const finishAt = atUtcHour(checkInDay, 15);
  const checkOutAt = atUtcHour(addUtcDays(checkInDay, nights), 11);
  const cancelAt = atUtcHour(addUtcDays(checkInDay, nights + refundGraceDays), 15);

  return {
    checkIn,
    nights,
    finishAt,
    checkOutAt,
    cancelAt,
    finishAfter: isoTimeToRippleTime(finishAt.toISOString()),
    cancelAfter: isoTimeToRippleTime(cancelAt.toISOString()),
  };
}

export function buildEscrowCreate({
  account,
  destination,
  checkIn,
  amountXrp = '50',
  nights = 3,
  refundGraceDays = 1,
}) {
  requireClassicAddress(account, 'Account');
  requireClassicAddress(destination, 'Destination');
  const stay = createStayWindow(checkIn, nights, refundGraceDays);
  const amount = xrpToDrops(String(amountXrp));

  if (BigInt(amount) <= 0n) throw new RangeError('Escrow amount must be positive.');

  return {
    transaction: {
      TransactionType: 'EscrowCreate',
      Account: account,
      Destination: destination,
      Amount: amount,
      FinishAfter: stay.finishAfter,
      CancelAfter: stay.cancelAfter,
      Memos: [
        memo(BOOKING_MEMO_TYPE, {
          v: 1,
          stay: 'wildlight-city-loft',
          checkIn: stay.checkIn,
          nights: stay.nights,
          asset: 'XRP',
        }),
      ],
    },
    stay,
  };
}

export function buildReceiptMint({ account, escrowHash, receiptUrl }) {
  requireClassicAddress(account, 'Account');
  const hash = requireHash(escrowHash);
  const baseUrl = String(receiptUrl || '').replace(/[?#].*$/, '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(baseUrl)) throw new TypeError('Receipt URL must use HTTP or HTTPS.');

  const uri = `${baseUrl}/?receipt=${hash}`;
  if (new TextEncoder().encode(uri).length > 256) {
    throw new RangeError('Receipt URI exceeds the XRPL 256-byte NFT limit.');
  }

  return {
    TransactionType: 'NFTokenMint',
    Account: account,
    NFTokenTaxon: RECEIPT_TAXON,
    URI: convertStringToHex(uri),
    Memos: [
      memo(RECEIPT_MEMO_TYPE, {
        v: 1,
        escrow: hash,
      }),
    ],
  };
}

export function buildEscrowAction({ action, account, owner, offerSequence }) {
  requireClassicAddress(account, 'Account');
  requireClassicAddress(owner, 'Owner');
  if (!Number.isInteger(offerSequence) || offerSequence < 0) {
    throw new TypeError('OfferSequence must be a non-negative integer.');
  }
  if (action !== 'finish' && action !== 'cancel') {
    throw new TypeError('Escrow action must be finish or cancel.');
  }

  return {
    TransactionType: action === 'finish' ? 'EscrowFinish' : 'EscrowCancel',
    Account: account,
    Owner: owner,
    OfferSequence: offerSequence,
  };
}

export function unwrapTransaction(result) {
  if (!result || typeof result !== 'object') throw new TypeError('Missing XRPL transaction.');
  return result.tx_json && typeof result.tx_json === 'object' ? result.tx_json : result;
}

export function transactionResult(result) {
  const meta = result?.meta;
  if (!meta || typeof meta === 'string') return null;
  return meta.TransactionResult || null;
}

export function parseEscrowTransaction(result) {
  const tx = unwrapTransaction(result);
  if (tx.TransactionType !== 'EscrowCreate') {
    throw new TypeError('That hash is not an EscrowCreate transaction.');
  }
  if (!result.validated) throw new TypeError('Escrow transaction is not validated yet.');
  if (transactionResult(result) !== 'tesSUCCESS') {
    throw new TypeError(`Escrow creation failed with ${transactionResult(result) || 'an unknown result'}.`);
  }
  if (typeof tx.Amount !== 'string') {
    throw new TypeError('This experience currently supports XRP escrows only.');
  }

  return {
    hash: requireHash(result.hash || tx.hash),
    owner: requireClassicAddress(tx.Account, 'Escrow owner'),
    destination: requireClassicAddress(tx.Destination, 'Escrow destination'),
    offerSequence: Number(tx.Sequence),
    amountDrops: tx.Amount,
    amountXrp: String(dropsToXrp(tx.Amount)),
    finishAfter: Number(tx.FinishAfter),
    cancelAfter: Number(tx.CancelAfter),
    finishAt: tx.FinishAfter ? new Date(rippleTimeToISOTime(tx.FinishAfter)) : null,
    cancelAt: tx.CancelAfter ? new Date(rippleTimeToISOTime(tx.CancelAfter)) : null,
    memo: decodeBookingMemo(tx.Memos),
  };
}

export function decodeBookingMemo(memos = []) {
  for (const item of memos || []) {
    const value = item?.Memo;
    if (!value?.MemoType || !value?.MemoData) continue;
    try {
      if (convertHexToString(value.MemoType) !== BOOKING_MEMO_TYPE) continue;
      return JSON.parse(convertHexToString(value.MemoData));
    } catch {
      return null;
    }
  }
  return null;
}
