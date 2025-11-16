// Background service worker for the extension

const ALARM_NAME = 'checkNewMessages';
const CHECK_INTERVAL_MINUTES = 1; // Check every minute

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
  } else if (request.type === 'MARK_CONVERSATION_READ') {
    // Mark conversation as read in storage
    markConversationAsRead(request.conversationSid).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }
  return true;
});

// Set up alarm when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated, setting up alarm');
  setupAlarm();
});

// Set up alarm when service worker starts
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Chrome started, setting up alarm');
  setupAlarm();
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[Background] Alarm triggered, checking for new messages');
    checkForNewMessages();
  }
});

// Set up periodic alarm
function setupAlarm() {
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_MINUTES,
    delayInMinutes: CHECK_INTERVAL_MINUTES
  });
  console.log(`[Background] Alarm created to check every ${CHECK_INTERVAL_MINUTES} minute(s)`);
}

// Main function to check for new messages
async function checkForNewMessages() {
  try {
    console.log('[Background] Starting message check...');

    // Get credentials from storage
    const saved = await chrome.storage.local.get([
      'backendUrl',
      'apiKey',
      'lastKnownConversations'
    ]);

    if (!saved.backendUrl) {
      console.log('[Background] No backend URL configured, skipping check');
      return;
    }

    // Fetch current conversations
    const headers = {};
    if (saved.apiKey) {
      headers['x-api-key'] = saved.apiKey;
    }

    const response = await fetch(`${saved.backendUrl}/api/conversations?limit=50`, {
      headers
    });

    if (!response.ok) {
      console.error('[Background] Failed to fetch conversations:', response.status);
      return;
    }

    const data = await response.json();
    const currentConversations = data.conversations || [];

    console.log(`[Background] Fetched ${currentConversations.length} conversations`);

    // Get last known state
    const lastKnown = saved.lastKnownConversations || {};

    // Track new/updated conversations
    const updates = [];

    for (const conv of currentConversations) {
      const lastKnownConv = lastKnown[conv.sid];

      const currentTime = new Date(conv.dateUpdated).getTime();

      if (!lastKnownConv) {
        // New conversation - don't notify on first discovery (could be old)
        console.log(`[Background] New conversation discovered (no notification): ${conv.sid}`);
      } else {
        const lastKnownTime = new Date(lastKnownConv.dateUpdated).getTime();

        // Check if conversation has been updated since last check
        if (currentTime > lastKnownTime) {
          console.log(`[Background] ✓ Conversation updated: ${conv.sid}`);

          updates.push({
            sid: conv.sid,
            contactName: conv.friendlyName || 'Unknown',
            isNew: false
          });
        }
      }
    }

    // Show notifications for updates
    if (updates.length > 0) {
      console.log(`[Background] ${updates.length} conversation(s) with updates`);

      // Track which conversations have unread messages
      const saved2 = await chrome.storage.local.get(['unreadConversations']);
      const unreadConversations = new Set(saved2.unreadConversations || []);

      for (const update of updates) {
        await showNotification(update);
        // Mark this conversation as unread
        unreadConversations.add(update.sid);
      }

      // Save unread conversations
      await chrome.storage.local.set({
        unreadConversations: Array.from(unreadConversations)
      });

      // Update badge with unread count
      await updateBadge(unreadConversations.size);
    } else {
      console.log('[Background] No new messages');
    }

    // Save current state as last known
    const newLastKnown = {};
    currentConversations.forEach(conv => {
      newLastKnown[conv.sid] = {
        dateUpdated: conv.dateUpdated,
        friendlyName: conv.friendlyName
      };
    });

    await chrome.storage.local.set({ lastKnownConversations: newLastKnown });
    console.log('[Background] Saved conversation state');

  } catch (error) {
    console.error('[Background] Error checking for new messages:', error);
  }
}

// Show notification for new/updated conversation
async function showNotification(update) {
  const title = update.isNew ? 'New conversation' : 'New message';
  const message = `From ${update.contactName}`;

  console.log(`[Background] Creating notification: ${title} - ${message}`);

  await chrome.notifications.create(update.sid, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: 2,
    requireInteraction: false
  });

  console.log(`[Background] Notification created for ${update.sid}`);
}

// Update badge count
async function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Mark conversation as read
async function markConversationAsRead(conversationSid) {
  try {
    const saved = await chrome.storage.local.get(['unreadConversations']);
    let unreadConversations = saved.unreadConversations || [];

    // Remove from unread list
    unreadConversations = unreadConversations.filter(sid => sid !== conversationSid);

    await chrome.storage.local.set({ unreadConversations });

    // Update badge count
    await updateBadge(unreadConversations.length);

    console.log(`[Background] Marked conversation ${conversationSid} as read`);
  } catch (error) {
    console.error('[Background] Error marking conversation as read:', error);
  }
}

// Initialize on load
console.log('[Background] Service worker loaded');
setupAlarm();

// Do an immediate check on startup (after a short delay to let things initialize)
setTimeout(() => {
  console.log('[Background] Performing initial message check');
  checkForNewMessages();
}, 5000); // 5 second delay
