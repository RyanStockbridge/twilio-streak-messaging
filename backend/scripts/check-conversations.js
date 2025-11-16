#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.trim().startsWith('#')) return;
    const index = line.indexOf('=');
    if (index === -1) return;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnv();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const serviceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID;

if (!accountSid || !authToken) {
  console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables.');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

const conversationLimit = parseInt(process.argv[2], 10) || 10;
const messageLimit = parseInt(process.argv[3], 10) || 5;

function isInboundMessage(message) {
  if (!message || !message.author) {
    return false;
  }
  const author = String(message.author);
  return !author.includes('@');
}

async function checkConversation(conversation) {
  const participants = await client.conversations.v1
    .conversations(conversation.sid)
    .participants.list();

  const messages = await client.conversations.v1
    .conversations(conversation.sid)
    .messages.list({ limit: messageLimit });

  const smsParticipants = participants.filter(
    participant => participant.messagingBinding && participant.messagingBinding.address
  );

  const latestInbound = messages.find(isInboundMessage);

  const autoCreateLikely =
    conversation.createdBy === 'system' && smsParticipants.length > 0;

  return {
    sid: conversation.sid,
    friendlyName: conversation.friendlyName || '(no friendly name)',
    createdBy: conversation.createdBy || 'unknown',
    dateCreated: conversation.dateCreated,
    smsParticipants: smsParticipants.map(
      participant => `${participant.messagingBinding.address} (proxy ${participant.messagingBinding.proxyAddress})`
    ),
    latestInbound: latestInbound
      ? {
          author: latestInbound.author,
          body: latestInbound.body,
          dateCreated: latestInbound.dateCreated
        }
      : null,
    autoCreateLikely
  };
}

async function main() {
  console.log('Checking Twilio Conversations for auto-create status...');
  if (serviceSid) {
    console.log(`Service SID: ${serviceSid}`);
  }

  const conversations = await client.conversations.v1.conversations.list({ limit: conversationLimit });

  for (const conversation of conversations) {
    const report = await checkConversation(conversation);
    console.log('-------------------------------------');
    console.log(`Conversation SID: ${report.sid}`);
    console.log(`Friendly Name  : ${report.friendlyName}`);
    console.log(`Created By     : ${report.createdBy}`);
    console.log(`Created At     : ${report.dateCreated}`);
    console.log(`SMS Participants (${report.smsParticipants.length}):`);
    if (report.smsParticipants.length > 0) {
      report.smsParticipants.forEach(participant => console.log(`  - ${participant}`));
    } else {
      console.log('  (none)');
    }
    if (report.latestInbound) {
      console.log(`Latest Inbound : ${report.latestInbound.author} at ${report.latestInbound.dateCreated}`);
      console.log(`  Body        : ${report.latestInbound.body || '(empty)'}`);
    } else {
      console.log('Latest Inbound : (none found in recent messages)');
    }
    console.log(`AutoCreate?    : ${report.autoCreateLikely ? 'Likely YES' : 'No evidence'}`);
  }

  console.log('Done.');
}

main().catch(error => {
  console.error('Error checking conversations:', error);
  process.exit(1);
});
