// Background service worker for the extension

const POLL_ALARM = 'twilioNotificationPoll';
const POLL_INTERVAL_MINUTES = 1;

const notificationState = {
  backendUrl: null,
  apiKey: null,
  lastTimestamp: null,
  pendingNotifications: {}
};

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
  }
  return true;
});

function normalizeBackendUrl(url) {
  if (!url) return null;
  return url.replace(/\/$/, '');
}

function buildPollUrl() {
  if (!notificationState.backendUrl) return null;
  try {
    const url = new URL('/api/notifications/poll', notificationState.backendUrl);
    if (notificationState.apiKey) {
      url.searchParams.set('apiKey', notificationState.apiKey);
    }
    if (notificationState.lastTimestamp) {
      url.searchParams.set('since', notificationState.lastTimestamp);
    }
    return url.toString();
  } catch (error) {
    console.error('Invalid backend URL for notification polling:', error);
    return null;
  }
}

function scheduleAlarm() {
  chrome.alarms.clear(POLL_ALARM, () => {
    if (!notificationState.backendUrl) return;
    chrome.alarms.create(POLL_ALARM, {
      periodInMinutes: POLL_INTERVAL_MINUTES
    });
  });
}

async function pollNotifications() {
  const pollUrl = buildPollUrl();
  if (!pollUrl) return;

  try {
    const response = await fetch(pollUrl, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Notification poll failed: ${response.status}`);
    }

    const data = await response.json();
    const events = Array.isArray(data.events) ? data.events : [];

    if (!events.length) {
      return;
    }

    events.forEach(event => {
      if (event.type !== 'incoming_message') {
        return;
      }

      notificationState.lastTimestamp = event.timestamp;
      chrome.storage.local.set({ lastNotificationTimestamp: event.timestamp });

      const notificationId = `msg-${event.payload?.conversationSid || ''}-${Date.now()}`;
      notificationState.pendingNotifications[notificationId] = {
        conversationSid: event.payload?.conversationSid || null
      };

      const title = event.payload?.from || 'New message';
      const message = event.payload?.body || 'New message received.';

      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message,
        priority: 1
      });
    });
  } catch (error) {
    console.error('Notification polling error:', error);
  }
}

function updateSettings(newSettings) {
  const backendUrl = normalizeBackendUrl(newSettings.backendUrl);
  const apiKey = newSettings.apiKey || null;

  notificationState.backendUrl = backendUrl;
  notificationState.apiKey = apiKey;

  if (!notificationState.lastTimestamp && newSettings.lastNotificationTimestamp) {
    notificationState.lastTimestamp = newSettings.lastNotificationTimestamp;
  }

  if (backendUrl) {
    scheduleAlarm();
    pollNotifications();
  } else {
    chrome.alarms.clear(POLL_ALARM);
  }
}

chrome.storage.local.get(['backendUrl', 'apiKey', 'lastNotificationTimestamp'], (items) => {
  updateSettings(items);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if ('backendUrl' in changes || 'apiKey' in changes) {
    chrome.storage.local.get(['backendUrl', 'apiKey', 'lastNotificationTimestamp'], (items) => {
      updateSettings(items);
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'apiKey', 'lastNotificationTimestamp'], (items) => {
    updateSettings(items);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'apiKey', 'lastNotificationTimestamp'], (items) => {
    updateSettings(items);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollNotifications();
  }
});

function openConversationFromNotification(info) {
  chrome.windows.getCurrent((windowInfo) => {
    chrome.sidePanel.open({ windowId: windowInfo.id }).then(() => {
      if (info.conversationSid) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'FOCUS_CONVERSATION',
            conversationSid: info.conversationSid
          });
        }, 300);
      }
    });
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  const info = notificationState.pendingNotifications[notificationId];
  if (info) {
    openConversationFromNotification(info);
    delete notificationState.pendingNotifications[notificationId];
  }
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  if (notificationState.pendingNotifications[notificationId]) {
    delete notificationState.pendingNotifications[notificationId];
  }
});
