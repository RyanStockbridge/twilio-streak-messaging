// Background service worker for the extension

const ALARM_NAME = 'checkNewMessages';
const CHECK_INTERVAL_MINUTES = 0.25; // 15 seconds for testing

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

    // Log all conversations with their dates for debugging
    if (currentConversations.length > 0) {
      console.log('[Background] All conversations:');
      currentConversations.forEach(conv => {
        console.log(`  ${conv.sid}: ${conv.friendlyName} - Latest Message: ${conv.latestMessageDate || 'none'}`);
      });
    }

    // Get last known state
    const lastKnown = saved.lastKnownConversations || {};

    console.log('[Background] Last known conversations:', Object.keys(lastKnown).length);
    if (Object.keys(lastKnown).length > 0) {
      const firstKey = Object.keys(lastKnown)[0];
      console.log(`  Example: ${firstKey} - Last message: ${lastKnown[firstKey].latestMessageDate || 'none'}`);
    }

    // Track new/updated conversations
    const updates = [];

    for (const conv of currentConversations) {
      const lastKnownConv = lastKnown[conv.sid];

      // Use latestMessageDate if available, otherwise fall back to dateUpdated
      const currentMessageDate = conv.latestMessageDate || conv.dateUpdated;
      const currentTime = new Date(currentMessageDate).getTime();

      if (!lastKnownConv) {
        // New conversation - don't notify on first discovery (could be old)
        console.log(`[Background] New conversation discovered (no notification): ${conv.sid}`);
      } else {
        const lastKnownMessageDate = lastKnownConv.latestMessageDate || lastKnownConv.dateUpdated;
        const lastKnownTime = new Date(lastKnownMessageDate).getTime();

        console.log(`[Background] Checking ${conv.sid}:`);
        console.log(`  Current: ${currentMessageDate} (${currentTime})`);
        console.log(`  Last Known: ${lastKnownMessageDate} (${lastKnownTime})`);
        console.log(`  Is Updated: ${currentTime > lastKnownTime}`);

        // Check if conversation has new messages since last check
        if (currentTime > lastKnownTime) {
          console.log(`[Background] ✓ New message detected: ${conv.sid}`);

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

      for (const update of updates) {
        await showNotification(update);

        // Update badge
        await updateBadge(updates.length);
      }
    } else {
      console.log('[Background] No new messages');
      // Clear badge if no updates
      chrome.action.setBadgeText({ text: '' });
    }

    // Save current state as last known
    const newLastKnown = {};
    currentConversations.forEach(conv => {
      newLastKnown[conv.sid] = {
        dateUpdated: conv.dateUpdated,
        latestMessageDate: conv.latestMessageDate,
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
    const saved = await chrome.storage.local.get(['lastKnownConversations']);
    const lastKnown = saved.lastKnownConversations || {};

    // Update the conversation's last read time to now
    if (lastKnown[conversationSid]) {
      lastKnown[conversationSid].lastReadTime = new Date().toISOString();
    }

    await chrome.storage.local.set({ lastKnownConversations: lastKnown });
    console.log(`[Background] Marked conversation ${conversationSid} as read`);
  } catch (error) {
    console.error('[Background] Error marking conversation as read:', error);
  }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log(`[Background] Notification clicked: ${notificationId}`);

  // notificationId is the conversationSid
  // Store it so the side panel can open it
  await chrome.storage.local.set({
    pendingConversationOpen: notificationId
  });

  // Get the current window
  const windows = await chrome.windows.getAll();
  if (windows.length > 0) {
    // Open side panel in the first window
    chrome.sidePanel.open({ windowId: windows[0].id });
  }

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

// Initialize on load
console.log('[Background] Service worker loaded');
setupAlarm();

// Do an immediate check on startup (after a short delay to let things initialize)
setTimeout(() => {
  console.log('[Background] Performing initial message check');
  checkForNewMessages();
}, 5000); // 5 second delay
