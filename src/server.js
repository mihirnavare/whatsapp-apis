require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const path = require('path');

const app = express();

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(morgan('dev'));

app.use('/', routes);
// in src/server.js (near top)
const cors = require('cors');
app.use(cors({ origin: '*' })); // for dev only; lock origins in production


const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const SESSION_EXPIRY_HOURS = Number(process.env.SESSION_EXPIRY_HOURS || 6);
const EXPIRY_MS = SESSION_EXPIRY_HOURS * 60 * 60 * 1000;

// Simple periodic cleanup to remove expired client entries
const { listClients, stopClient, getClientEntry } = require('./clientsRegistry');

setInterval(async () => {
  try {
    const now = Date.now();
    const clients = listClients();
    for (const c of clients) {
      if (c.expiresAt && c.expiresAt < now) {
        console.log(`Cleaning expired client ${c.clientId}`);
        await stopClient(c.clientId);
      } else {
        // optional ping/update last seen
        const entry = getClientEntry(c.clientId);
        if (entry) entry.lastSeen = Date.now();
      }
    }
  } catch (e) {
    console.error('cleanup error', e);
  }
}, 60 * 1000); // every minute

app.listen(PORT, HOST, () => {
  console.log(`Server listening at http://${HOST}:${PORT}`);
});
