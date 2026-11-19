// Il «centralino» di Squillo: un piccolo servizio che mette in contatto due persone (segnalazione).
// NON vede audio né video: quelli viaggiano direttamente fra le due persone.
//
// Avvio:  npm run centralino            (porta 9000; cambia con PORT=8080)
// In Squillo → Impostazioni → Centralino: inserisci l'indirizzo e la porta di questo servizio.
// Per usarlo da Internet serve un indirizzo con HTTPS (per esempio su Render, Fly.io o un tuo server).
import { PeerServer } from 'peer';

const port = Number(process.env.PORT ?? 9000);
const server = PeerServer({
  host: process.env.HOST ?? '0.0.0.0',
  port,
  path: process.env.PEER_PATH ?? '/',
  key: process.env.PEER_KEY ?? 'peerjs',
  proxied: process.env.PROXIED === '1', // dietro a un servizio che gestisce l'HTTPS
  allow_discovery: false, // nessuno può chiedere l'elenco di chi è collegato
  corsOptions: { origin: true },
  concurrent_limit: Number(process.env.LIMIT ?? 5000),
  alive_timeout: 60_000,
});
server.on('connection', (c) => console.log('connesso', c.getId().slice(0, 12)));
server.on('disconnect', (c) => console.log('uscito', c.getId().slice(0, 12)));
console.log(`Centralino Squillo in ascolto sulla porta ${port}`);
process.on('SIGTERM', () => process.exit(0));
