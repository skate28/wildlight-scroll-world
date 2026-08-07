import { build } from 'esbuild';
import { isValidClassicAddress } from 'xrpl';

const NETWORKS = {
  testnet: {
    ws: 'wss://s.altnet.rippletest.net:51233',
    explorer: 'https://testnet.xrpl.org',
  },
  mainnet: {
    ws: 'wss://xrplcluster.com',
    explorer: 'https://livenet.xrpl.org',
  },
};

const network = (process.env.XRPL_NETWORK || 'testnet').toLowerCase();
if (!NETWORKS[network]) {
  throw new Error(`XRPL_NETWORK must be one of: ${Object.keys(NETWORKS).join(', ')}.`);
}

if (network === 'mainnet' && process.env.WILDLIGHT_ENABLE_MAINNET !== 'true') {
  throw new Error(
    'Mainnet booking is locked. Set WILDLIGHT_ENABLE_MAINNET=true only after production review.',
  );
}

const testnetDestination = 'rJAz9M9KnQ8pzSSzcVgXdm3V9AEJhrbe5L';
const destination =
  process.env.XRPL_ESCROW_DESTINATION || (network === 'testnet' ? testnetDestination : '');

if (!isValidClassicAddress(destination)) {
  throw new Error('XRPL_ESCROW_DESTINATION must be a valid funded classic address.');
}

const siteUrl = (
  process.env.DEPLOY_PRIME_URL ||
  process.env.URL ||
  'https://wildlight-scroll-world.netlify.app'
).replace(/\/$/, '');

const publicConfig = {
  network,
  ...NETWORKS[network],
  destination,
  amountXrp: '50',
  nights: 3,
  refundGraceDays: 1,
  siteUrl,
  xamanApiKey: process.env.XRPL_XAMAN_API_KEY || '',
};

await build({
  entryPoints: ['src/booking.js'],
  outfile: 'booking.bundle.js',
  bundle: true,
  minify: true,
  legalComments: 'none',
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  define: {
    __WILDLIGHT_CONFIG__: JSON.stringify(publicConfig),
    'process.env.NODE_ENV': '"production"',
  },
});

console.log(
  `Built XRPL booking bundle for ${network} (${publicConfig.xamanApiKey ? 'Xaman enabled' : 'extension wallets'}).`,
);
