import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
const publicKey = ecdh.generateKeys();
const privateKey = ecdh.getPrivateKey();
const toBase64Url = value => Buffer.from(value).toString('base64url');

process.stdout.write([
  `VITE_WEB_PUSH_PUBLIC_KEY=${toBase64Url(publicKey)}`,
  `WEB_PUSH_PUBLIC_KEY=${toBase64Url(publicKey)}`,
  `WEB_PUSH_PRIVATE_KEY=${toBase64Url(privateKey)}`,
  'WEB_PUSH_SUBJECT=mailto:support@stampfy.com',
].join('\n') + '\n');
