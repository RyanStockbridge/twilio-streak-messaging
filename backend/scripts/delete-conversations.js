#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    if (!line || line.trim().startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN before running.');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

async function main() {
  console.log('Fetching conversations...');
  const conversations = await client.conversations.v1.conversations.list();
  if (conversations.length === 0) {
    console.log('No conversations found.');
    return;
  }

  console.log(`Deleting ${conversations.length} conversations...`);
  for (const conversation of conversations) {
    try {
      await client.conversations.v1.conversations(conversation.sid).remove();
      console.log(`Deleted ${conversation.sid}`);
    } catch (err) {
      console.error(`Failed to delete ${conversation.sid}:`, err.message);
    }
  }
  console.log('Done.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
