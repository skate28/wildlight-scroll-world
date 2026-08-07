import {
  CrossmarkAdapter,
  GemWalletAdapter,
  OtsuAdapter,
  WalletErrorCode,
  WalletManager,
  XamanAdapter,
  XyraAdapter,
  isWalletError,
} from 'xrpl-connect';
import { Client, getNFTokenID, xrpToDrops } from 'xrpl';
import {
  buildEscrowAction,
  buildEscrowCreate,
  buildReceiptMint,
  createStayWindow,
  parseEscrowTransaction,
  transactionResult,
} from './booking-utils.js';

const BUILD_CONFIG =
  typeof __WILDLIGHT_CONFIG__ !== 'undefined' ? __WILDLIGHT_CONFIG__ : {};

const config = {
  network: 'testnet',
  ws: 'wss://s.altnet.rippletest.net:51233',
  explorer: 'https://testnet.xrpl.org',
  faucet: 'https://xrpl.org/resources/dev-tools/xrp-faucets',
  destination: 'rJAz9M9KnQ8pzSSzcVgXdm3V9AEJhrbe5L',
  amountXrp: '50',
  nights: 3,
  refundGraceDays: 1,
  siteUrl: 'https://wildlight-scroll-world.netlify.app',
  xamanApiKey: '',
  ...BUILD_CONFIG,
};

const receiptHashFromUrl = new URLSearchParams(window.location.search)
  .get('receipt')
  ?.trim()
  .toUpperCase();

const state = {
  engaged: Boolean(receiptHashFromUrl),
  connectedAddress: null,
  busy: false,
  booking: null,
  receipt: null,
  managedBooking: null,
  managedAction: null,
  ledger: null,
  ledgerPromise: null,
};

const root = document.createElement('aside');
root.className = 'wl-booking';
root.id = 'wildlight-booking';
root.setAttribute('aria-hidden', 'true');
root.inert = true;
root.innerHTML = `
  <section class="wl-booking__folio" aria-labelledby="wl-booking-title">
    <div class="wl-booking__rail" aria-hidden="true">
      <span class="wl-booking__monogram">W/L</span>
      <i></i>
      <span>XRPL · TESTNET</span>
    </div>

    <div class="wl-booking__content">
      <header class="wl-booking__header">
        <div>
          <span class="wl-booking__kicker">City loft · three nights</span>
          <span class="wl-booking__network"><i></i> Testnet demonstration</span>
        </div>
        <span class="wl-booking__chapter" aria-hidden="true">05</span>
      </header>

      <div class="wl-booking__view" data-view="book">
        <h2 id="wl-booking-title" tabindex="-1">Hold this date.</h2>
        <p class="wl-booking__lede">
          Place a 50 XRP deposit in a time-locked escrow. Wildlight can receive it at
          check-in; if it remains unclaimed after checkout, it becomes refundable.
        </p>

        <div class="wl-booking__amount">
          <span>Escrow deposit</span>
          <strong>50 <small>XRP</small></strong>
        </div>

        <label class="wl-booking__date">
          <span>Check-in</span>
          <input type="date" data-check-in />
        </label>

        <dl class="wl-booking__terms">
          <div><dt>Check-out</dt><dd data-check-out>—</dd></div>
          <div><dt>Host can claim</dt><dd data-release>—</dd></div>
          <div><dt>Refund opens</dt><dd data-refund>—</dd></div>
        </dl>

        <div class="wl-booking__wallet">
          <span data-wallet-state>No wallet connected</span>
          <button type="button" class="wl-link" data-wallet-button>Connect wallet</button>
          <button type="button" class="wl-link wl-link--quiet" data-disconnect hidden>Disconnect</button>
        </div>

        <button type="button" class="wl-booking__primary" data-create disabled>
          Hold with 50 test XRP
        </button>

        <p class="wl-booking__fineprint">
          Testnet XRP has no monetary value. Your wallet shows every transaction before
          signing; this site never receives your secret key.
        </p>

        <button type="button" class="wl-booking__manage-link" data-open-manage>
          Manage an existing hold <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div class="wl-booking__view" data-view="confirmed" hidden>
        <span class="wl-booking__seal" aria-hidden="true">✓</span>
        <span class="wl-booking__kicker">Validated on the XRP Ledger</span>
        <h2 tabindex="-1" data-confirm-title>Your date is held.</h2>
        <p class="wl-booking__lede" data-confirm-copy>
          The deposit is locked by the ledger until your check-in window.
        </p>

        <dl class="wl-booking__receipt">
          <div><dt>Deposit</dt><dd data-confirm-amount>—</dd></div>
          <div><dt>Check-in</dt><dd data-confirm-date>—</dd></div>
          <div><dt>Refund opens</dt><dd data-confirm-refund>—</dd></div>
          <div class="wl-booking__receipt-hash">
            <dt>Escrow transaction</dt>
            <dd><a data-escrow-link target="_blank" rel="noreferrer">—</a></dd>
          </div>
        </dl>

        <button type="button" class="wl-booking__primary" data-mint>
          Mint receipt NFT
        </button>
        <div class="wl-booking__nft" data-nft-result hidden>
          <span>Receipt NFT minted</span>
          <a data-nft-link target="_blank" rel="noreferrer">View transaction</a>
        </div>
        <button type="button" class="wl-booking__manage-link" data-manage-confirmed>
          Manage this escrow <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div class="wl-booking__view" data-view="manage" hidden>
        <button type="button" class="wl-booking__back" data-back aria-label="Back to booking">←</button>
        <span class="wl-booking__kicker">Escrow desk</span>
        <h2 tabindex="-1">Manage a hold.</h2>
        <p class="wl-booking__lede">
          Paste an EscrowCreate transaction hash to verify its current release or refund window.
        </p>
        <form class="wl-booking__lookup" data-lookup-form>
          <label>
            <span>Escrow transaction hash</span>
            <input
              type="text"
              inputmode="text"
              autocomplete="off"
              spellcheck="false"
              maxlength="64"
              placeholder="64-character transaction hash"
              data-lookup-hash
            />
          </label>
          <button type="submit">Verify</button>
        </form>
        <dl class="wl-booking__receipt" data-manage-details hidden>
          <div><dt>Status</dt><dd data-manage-state>—</dd></div>
          <div><dt>Deposit</dt><dd data-manage-amount>—</dd></div>
          <div><dt>Release</dt><dd data-manage-release>—</dd></div>
          <div><dt>Refund</dt><dd data-manage-refund>—</dd></div>
        </dl>
        <button type="button" class="wl-booking__primary" data-manage-action hidden></button>
      </div>

      <div class="wl-booking__status" data-status hidden role="status" aria-live="polite">
        <i aria-hidden="true"></i>
        <div><strong data-status-title></strong><span data-status-copy></span></div>
      </div>
    </div>
  </section>
  <xrpl-wallet-connector data-wallet-connector></xrpl-wallet-connector>
`;
document.body.appendChild(root);

const $ = (selector) => root.querySelector(selector);
const elements = {
  checkIn: $('[data-check-in]'),
  checkOut: $('[data-check-out]'),
  release: $('[data-release]'),
  refund: $('[data-refund]'),
  walletState: $('[data-wallet-state]'),
  walletButton: $('[data-wallet-button]'),
  disconnect: $('[data-disconnect]'),
  create: $('[data-create]'),
  mint: $('[data-mint]'),
  nftResult: $('[data-nft-result]'),
  nftLink: $('[data-nft-link]'),
  status: $('[data-status]'),
  statusTitle: $('[data-status-title]'),
  statusCopy: $('[data-status-copy]'),
  connector: $('[data-wallet-connector]'),
  lookupForm: $('[data-lookup-form]'),
  lookupHash: $('[data-lookup-hash]'),
  manageDetails: $('[data-manage-details]'),
  manageAction: $('[data-manage-action]'),
};

const adapters = [];
if (config.xamanApiKey) {
  adapters.push(new XamanAdapter({ apiKey: config.xamanApiKey }));
}
adapters.push(
  new CrossmarkAdapter(),
  new GemWalletAdapter(),
  new XyraAdapter(),
  new OtsuAdapter(),
);

const walletManager = new WalletManager({
  adapters,
  network: config.network,
  autoConnect: false,
  logger: { level: 'error', prefix: '[Wildlight wallet]' },
});

elements.connector.setAttribute('wallets', adapters.map((adapter) => adapter.id).join(','));
if (config.xamanApiKey) elements.connector.setAttribute('primary-wallet', 'xaman');
elements.connector.setWalletManager(walletManager);

walletManager.on('connect', (account) => {
  state.connectedAddress = account.address;
  updateWalletState();
  clearStatus();
});
walletManager.on('disconnect', () => {
  state.connectedAddress = null;
  updateWalletState();
});
walletManager.on('accountChanged', (account) => {
  state.connectedAddress = account.address;
  updateWalletState();
});
walletManager.on('networkChanged', (network) => {
  if (network?.id && network.id !== config.network) {
    showStatus('Wrong network', `Switch your wallet to XRPL ${labelNetwork(config.network)}.`, 'error');
  }
});
walletManager.on('error', (error) => {
  if (!isUserRejection(error)) showStatus('Wallet connection failed', humanError(error), 'error');
});

void walletManager.reconnect().then((account) => {
  if (account) {
    state.connectedAddress = account.address;
    updateWalletState();
  }
});

function utcDateInput(daysFromNow) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

elements.checkIn.min = utcDateInput(1);
elements.checkIn.value = utcDateInput(30);
updateStayTerms();
updateWalletState();

elements.checkIn.addEventListener('change', () => {
  state.engaged = true;
  updateStayTerms();
});
elements.walletButton.addEventListener('click', () => {
  state.engaged = true;
  elements.connector.open();
});
elements.disconnect.addEventListener('click', () => void walletManager.disconnect());
elements.create.addEventListener('click', () => void createHold());
elements.mint.addEventListener('click', () => void mintReceipt());
$('[data-open-manage]').addEventListener('click', () => showManage());
$('[data-manage-confirmed]').addEventListener('click', () => showManage(state.booking?.hash));
$('[data-back]').addEventListener('click', () => {
  showView(state.booking ? 'confirmed' : 'book');
  clearStatus();
});
elements.lookupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadManagedEscrow(elements.lookupHash.value);
});
elements.manageAction.addEventListener('click', () => void submitManagedAction());

window.addEventListener('scroll', updateReveal, { passive: true });
window.addEventListener('resize', updateReveal, { passive: true });
window.addEventListener('pagehide', disconnectLedger, { once: true });
updateReveal();

if (receiptHashFromUrl) {
  showManage(receiptHashFromUrl);
  void loadManagedEscrow(receiptHashFromUrl, true);
}

function updateReveal() {
  const scrollMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const atEnd = window.scrollY >= scrollMax - Math.max(24, window.innerHeight * 0.018);
  const visible = atEnd || state.engaged;
  root.classList.toggle('is-visible', visible);
  root.setAttribute('aria-hidden', String(!visible));
  root.inert = !visible;
}

function updateStayTerms() {
  try {
    const stay = createStayWindow(
      elements.checkIn.value,
      config.nights,
      config.refundGraceDays,
    );
    elements.checkOut.textContent = formatDate(stay.checkOutAt);
    elements.release.textContent = formatDateTime(stay.finishAt);
    elements.refund.textContent = formatDateTime(stay.cancelAt);
    elements.create.disabled = !state.connectedAddress || state.busy;
    clearStatus();
  } catch (error) {
    elements.create.disabled = true;
    showStatus('Choose another date', humanError(error), 'error');
  }
}

function updateWalletState() {
  const connected = Boolean(state.connectedAddress);
  elements.walletState.textContent = connected
    ? `Connected · ${truncate(state.connectedAddress)}`
    : 'No wallet connected';
  elements.walletButton.textContent = connected ? 'Change wallet' : 'Connect wallet';
  elements.disconnect.hidden = !connected;
  elements.create.disabled = !connected || state.busy;

  if (state.booking) {
    const ownsReceipt = state.connectedAddress === state.booking.owner;
    elements.mint.disabled = !ownsReceipt || state.busy || Boolean(state.receipt);
    if (!state.receipt) {
      elements.mint.textContent = ownsReceipt ? 'Mint receipt NFT' : 'Connect the depositor wallet';
    }
  }
}

async function createHold() {
  if (!state.connectedAddress) {
    elements.connector.open();
    return;
  }

  state.engaged = true;
  setBusy(true);
  try {
    const { transaction } = buildEscrowCreate({
      account: state.connectedAddress,
      destination: config.destination,
      checkIn: elements.checkIn.value,
      amountXrp: config.amountXrp,
      nights: config.nights,
      refundGraceDays: config.refundGraceDays,
    });

    if (transaction.FinishAfter <= nowRippleTime()) {
      throw new Error('Check-in must be in the future.');
    }

    showStatus('Checking Testnet account', 'Confirming available XRP and network.', 'working');
    await assertAccountCanDeposit(state.connectedAddress, transaction.Amount);

    showStatus('Review in your wallet', 'Confirm the 50 XRP EscrowCreate transaction.', 'working');
    const submitted = await walletManager.signAndSubmit(transaction);
    const hash = requireSubmittedHash(submitted);

    showStatus('Waiting for validation', truncate(hash, 8), 'working');
    const validated = await waitForValidation(hash);
    const booking = parseEscrowTransaction(validated);
    assertWildlightEscrow(booking);

    state.booking = booking;
    storeBooking({ escrowHash: booking.hash });
    renderConfirmation(booking);
    showStatus('Escrow validated', 'Your deposit is now time-locked on XRPL Testnet.', 'success');
  } catch (error) {
    if (isUserRejection(error)) {
      showStatus('No transaction submitted', 'The wallet request was closed.', 'neutral');
    } else {
      showStatus('Could not create the hold', humanError(error), 'error');
    }
  } finally {
    setBusy(false);
  }
}

async function mintReceipt() {
  if (!state.booking) return;
  if (!state.connectedAddress) {
    elements.connector.open();
    return;
  }
  if (state.connectedAddress !== state.booking.owner) {
    showStatus('Connect the depositor wallet', 'The receipt must be minted by the escrow owner.', 'error');
    return;
  }

  setBusy(true);
  try {
    const transaction = buildReceiptMint({
      account: state.connectedAddress,
      escrowHash: state.booking.hash,
      receiptUrl: config.siteUrl,
    });
    showStatus('Review receipt NFT', 'This is a separate NFTokenMint transaction.', 'working');
    const submitted = await walletManager.signAndSubmit(transaction);
    const hash = requireSubmittedHash(submitted);

    showStatus('Minting receipt', 'Waiting for ledger validation.', 'working');
    const validated = await waitForValidation(hash);
    let nftId = null;
    try {
      nftId = getNFTokenID(validated.meta);
    } catch {
      // The mint is still valid even if a wallet/node returned reduced metadata.
    }

    state.receipt = { hash, nftId };
    storeBooking({ escrowHash: state.booking.hash, receiptHash: hash, nftId });
    renderReceipt(state.receipt);
    showStatus('Receipt NFT minted', 'The NFT links back to this verified escrow.', 'success');
  } catch (error) {
    if (isUserRejection(error)) {
      showStatus('Receipt not minted', 'The escrow remains active; no NFT transaction was submitted.', 'neutral');
    } else {
      showStatus('Could not mint the receipt', humanError(error), 'error');
    }
  } finally {
    setBusy(false);
  }
}

function renderConfirmation(booking) {
  showView('confirmed');
  $('[data-confirm-title]').textContent = 'Your date is held.';
  $('[data-confirm-copy]').textContent =
    'The deposit is locked by the ledger until the check-in window.';
  $('[data-confirm-amount]').textContent = `${booking.amountXrp} XRP`;
  $('[data-confirm-date]').textContent = booking.memo?.checkIn
    ? formatDate(new Date(`${booking.memo.checkIn}T12:00:00Z`))
    : formatDate(booking.finishAt);
  $('[data-confirm-refund]').textContent = formatDateTime(booking.cancelAt);
  const escrowLink = $('[data-escrow-link]');
  escrowLink.textContent = truncate(booking.hash, 8);
  escrowLink.href = transactionUrl(booking.hash);
  elements.lookupHash.value = booking.hash;
  updateWalletState();
  $('[data-confirm-title]').focus({ preventScroll: true });
}

function renderReceipt(receipt) {
  elements.mint.hidden = true;
  elements.nftResult.hidden = false;
  elements.nftLink.href = transactionUrl(receipt.hash);
  elements.nftLink.textContent = receipt.nftId ? truncate(receipt.nftId, 8) : 'View transaction';
}

function showManage(hash = '') {
  state.engaged = true;
  showView('manage');
  clearStatus();
  elements.lookupHash.value = hash || elements.lookupHash.value || '';
  elements.manageDetails.hidden = true;
  elements.manageAction.hidden = true;
  $('[data-view="manage"] h2').focus({ preventScroll: true });
}

async function loadManagedEscrow(rawHash, fromReceipt = false) {
  const hash = String(rawHash || '').trim().toUpperCase();
  setBusy(true);
  try {
    showStatus('Reading the ledger', 'Verifying the escrow transaction and current state.', 'working');
    const validated = await fetchValidatedTransaction(hash);
    const booking = parseEscrowTransaction(validated);
    assertWildlightEscrow(booking);
    const isOpen = await escrowIsOpen(booking);

    state.managedBooking = booking;
    state.booking = fromReceipt ? booking : state.booking;
    renderManagedEscrow(booking, isOpen);
    showStatus(
      isOpen ? 'Wildlight hold verified' : 'Escrow is closed',
      isOpen
        ? 'The transaction matches this stay and is still present on the ledger.'
        : 'The deposit has already been released or returned.',
      isOpen ? 'success' : 'neutral',
    );
  } catch (error) {
    state.managedBooking = null;
    elements.manageDetails.hidden = true;
    elements.manageAction.hidden = true;
    showStatus('Could not verify this hold', humanError(error), 'error');
  } finally {
    setBusy(false);
  }
}

function renderManagedEscrow(booking, isOpen) {
  elements.manageDetails.hidden = false;
  $('[data-manage-amount]').textContent = `${booking.amountXrp} XRP`;
  $('[data-manage-release]').textContent = formatDateTime(booking.finishAt);
  $('[data-manage-refund]').textContent = formatDateTime(booking.cancelAt);

  const now = Date.now();
  if (!isOpen) {
    state.managedAction = null;
    $('[data-manage-state]').textContent = 'Closed';
    elements.manageAction.hidden = true;
    return;
  }

  if (booking.cancelAt && now >= booking.cancelAt.getTime()) {
    state.managedAction = 'cancel';
    $('[data-manage-state]').textContent = 'Refund available';
    elements.manageAction.textContent = state.connectedAddress
      ? 'Return expired deposit'
      : 'Connect wallet to return deposit';
    elements.manageAction.hidden = false;
    elements.manageAction.disabled = state.busy;
  } else if (booking.finishAt && now >= booking.finishAt.getTime()) {
    state.managedAction = 'finish';
    $('[data-manage-state]').textContent = 'Release available';
    elements.manageAction.textContent = state.connectedAddress
      ? 'Release deposit to Wildlight'
      : 'Connect wallet to release deposit';
    elements.manageAction.hidden = false;
    elements.manageAction.disabled = state.busy;
  } else {
    state.managedAction = null;
    $('[data-manage-state]').textContent = 'Locked until check-in';
    elements.manageAction.textContent = `Release opens ${formatDateTime(booking.finishAt)}`;
    elements.manageAction.hidden = false;
    elements.manageAction.disabled = true;
  }
}

async function submitManagedAction() {
  if (!state.managedBooking || !state.managedAction) return;
  if (!state.connectedAddress) {
    elements.connector.open();
    return;
  }

  setBusy(true);
  try {
    const action = state.managedAction;
    const transaction = buildEscrowAction({
      action,
      account: state.connectedAddress,
      owner: state.managedBooking.owner,
      offerSequence: state.managedBooking.offerSequence,
    });
    showStatus(
      'Review in your wallet',
      action === 'finish'
        ? 'EscrowFinish releases the deposit to Wildlight.'
        : 'EscrowCancel returns the expired deposit to its sender.',
      'working',
    );
    const submitted = await walletManager.signAndSubmit(transaction);
    const hash = requireSubmittedHash(submitted);
    await waitForValidation(hash);

    elements.manageAction.hidden = true;
    $('[data-manage-state]').textContent = action === 'finish' ? 'Released' : 'Returned';
    showStatus(
      action === 'finish' ? 'Deposit released' : 'Deposit returned',
      `Validated as ${truncate(hash, 8)}.`,
      'success',
    );
  } catch (error) {
    if (isUserRejection(error)) {
      showStatus('No transaction submitted', 'The wallet request was closed.', 'neutral');
    } else {
      showStatus('Escrow action failed', humanError(error), 'error');
    }
  } finally {
    setBusy(false);
  }
}

function showView(name) {
  root.querySelectorAll('[data-view]').forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
}

function setBusy(busy) {
  state.busy = busy;
  root.classList.toggle('is-busy', busy);
  elements.checkIn.disabled = busy;
  elements.walletButton.disabled = busy;
  elements.disconnect.disabled = busy;
  elements.create.disabled = busy || !state.connectedAddress;
  elements.mint.disabled = busy || state.connectedAddress !== state.booking?.owner;
  elements.manageAction.disabled = busy || !state.managedAction;
  elements.lookupForm.querySelector('button').disabled = busy;
}

function showStatus(title, copy, tone = 'neutral') {
  elements.status.hidden = false;
  elements.status.dataset.tone = tone;
  elements.statusTitle.textContent = title;
  elements.statusCopy.textContent = copy || '';
}

function clearStatus() {
  if (state.busy) return;
  elements.status.hidden = true;
  elements.status.removeAttribute('data-tone');
  elements.statusTitle.textContent = '';
  elements.statusCopy.textContent = '';
}

async function ledgerClient() {
  if (state.ledger?.isConnected()) return state.ledger;
  if (state.ledgerPromise) return state.ledgerPromise;

  state.ledgerPromise = (async () => {
    const client = new Client(config.ws);
    await client.connect();
    state.ledger = client;
    state.ledgerPromise = null;
    return client;
  })().catch((error) => {
    state.ledgerPromise = null;
    throw error;
  });
  return state.ledgerPromise;
}

function disconnectLedger() {
  if (!state.ledger?.isConnected()) return;
  void state.ledger.disconnect().catch(() => {});
}

async function assertAccountCanDeposit(address, amountDrops) {
  const client = await ledgerClient();
  let response;
  try {
    response = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
      strict: true,
    });
  } catch (error) {
    if (String(error?.data?.error || error?.message).includes('actNotFound')) {
      throw new Error('This address is not funded on XRPL Testnet. Use the Testnet faucet first.');
    }
    throw error;
  }

  const balance = BigInt(response.result.account_data.Balance);
  const buffer = BigInt(xrpToDrops('2'));
  if (balance < BigInt(amountDrops) + buffer) {
    throw new Error('At least 52 test XRP is required for the deposit, reserve, and fee.');
  }
}

async function waitForValidation(hash, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await fetchValidatedTransaction(hash);
      const code = transactionResult(result);
      if (code !== 'tesSUCCESS') throw new Error(`XRPL returned ${code || 'an unknown result'}.`);
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransactionPending(error)) throw error;
    }
    await sleep(1500);
  }
  throw new Error(
    `Ledger validation timed out${lastError?.message ? `: ${lastError.message}` : '.'}`,
  );
}

async function fetchValidatedTransaction(rawHash) {
  const hash = String(rawHash || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(hash)) {
    throw new Error('Enter a complete 64-character transaction hash.');
  }
  const client = await ledgerClient();
  const response = await client.request({
    command: 'tx',
    transaction: hash,
    binary: false,
  });
  if (!response.result.validated) throw new Error('Transaction is still pending validation.');
  return { ...response.result, hash: response.result.hash || hash };
}

async function escrowIsOpen(booking) {
  const client = await ledgerClient();
  const response = await client.request({
    command: 'account_objects',
    account: booking.owner,
    type: 'escrow',
    ledger_index: 'validated',
  });
  return response.result.account_objects.some(
    (object) => object.PreviousTxnID === booking.hash,
  );
}

function assertWildlightEscrow(booking) {
  if (booking.destination !== config.destination) {
    throw new Error('This escrow was not created for the Wildlight booking account.');
  }
  if (booking.amountDrops !== xrpToDrops(config.amountXrp)) {
    throw new Error(`This escrow is not the expected ${config.amountXrp} XRP deposit.`);
  }
  if (!booking.finishAt || !booking.cancelAt) {
    throw new Error('This escrow does not include both release and refund windows.');
  }
}

function requireSubmittedHash(result) {
  const hash = String(result?.hash || result?.id || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(hash)) {
    throw new Error('The wallet did not return a transaction hash.');
  }
  return hash;
}

function nowRippleTime() {
  return Math.floor(Date.now() / 1000) - 946684800;
}

function transactionUrl(hash) {
  return `${config.explorer.replace(/\/$/, '')}/transactions/${hash}`;
}

function storeBooking(value) {
  try {
    localStorage.setItem('wildlight.xrpl.booking', JSON.stringify(value));
  } catch {
    // Local storage is a convenience only; the ledger remains the source of truth.
  }
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function truncate(value, side = 6) {
  const text = String(value || '');
  if (text.length <= side * 2 + 1) return text;
  return `${text.slice(0, side)}…${text.slice(-side)}`;
}

function labelNetwork(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUserRejection(error) {
  return (
    (isWalletError(error) &&
      [WalletErrorCode.SIGN_REJECTED, WalletErrorCode.CONNECTION_REJECTED].includes(error.code)) ||
    /reject|declin|cancel/i.test(String(error?.message || ''))
  );
}

function isTransactionPending(error) {
  const message = String(error?.data?.error || error?.message || '');
  return /txnNotFound|not found|pending validation/i.test(message);
}

function humanError(error) {
  const message = String(error?.message || error?.data?.error_message || error || 'Unknown error.');
  if (/actNotFound/i.test(message)) {
    return `This wallet is not funded on Testnet. Get test XRP at ${config.faucet}.`;
  }
  if (/tecUNFUNDED|insufficient|52 test XRP/i.test(message)) {
    return 'The wallet needs at least 52 test XRP for the deposit and account reserve.';
  }
  if (/tecNO_TARGET/i.test(message)) {
    return 'This escrow is already closed or no longer exists.';
  }
  if (/timeout/i.test(message)) {
    return 'Validation timed out. Confirm that your wallet is using XRPL Testnet, then check the hash.';
  }
  if (/network|websocket|socket/i.test(message)) {
    return 'The XRPL Testnet connection is unavailable. Try again in a moment.';
  }
  return message.replace(/^Error:\s*/i, '');
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
