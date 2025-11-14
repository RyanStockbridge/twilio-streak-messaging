// Application state
const state = {
  streakEmail: null,
  streakApiKey: null,
  backendUrl: null,
  apiKey: null,
  userTeams: [],
  conversations: [],
  currentConversation: null,
  messages: [],
  contactCache: {},
  conversationLimit: 50,
  conversationOffset: 0,
  hasMoreConversations: true,
  autoRefreshInterval: null,
  autoRefreshEnabled: true
};

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');
const conversationList = document.getElementById('conversation-list');
const messageThread = document.getElementById('message-thread');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const backBtn = document.getElementById('back-btn');
const refreshBtn = document.getElementById('refresh-btn');
const loadingIndicator = document.getElementById('loading');
const openStreakBtn = document.getElementById('open-streak-btn');
const filterByStreakCheckbox = document.getElementById('filter-by-streak');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const loadMoreBtn = document.getElementById('load-more-btn');
const loadMoreContainer = document.getElementById('load-more-container');

// Initialize app
async function init() {
  // Load saved credentials from chrome.storage
  const saved = await chrome.storage.local.get([
    'streakEmail',
    'streakApiKey',
    'backendUrl',
    'apiKey',
    'contactCache'
  ]);

  if (saved.streakEmail && saved.streakApiKey && saved.backendUrl) {
    state.streakEmail = saved.streakEmail;
    state.streakApiKey = saved.streakApiKey;
    state.backendUrl = saved.backendUrl;
    state.apiKey = saved.apiKey || null;
    state.contactCache = saved.contactCache || {};

    // Verify Streak access and load conversations
    const hasAccess = await verifyStreakAccess();
    if (hasAccess) {
      showMainScreen();
      await loadConversations();
    } else {
      showLoginScreen();
      showError('Unable to verify Streak access. Please login again.');
    }
  } else {
    showLoginScreen();
  }
}

// Show/hide screens
function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMainScreen() {
  loginScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
}

function showError(message) {
  loginError.textContent = message;
  loginError.classList.add('show');
  setTimeout(() => {
    loginError.classList.remove('show');
  }, 5000);
}

function showToast(message, type = 'info', duration = 3000) {
  toastMessage.textContent = message;
  toast.className = 'toast';
  if (type) {
    toast.classList.add(type);
  }
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// Streak API functions
async function verifyStreakAccess() {
  try {
    // Simply verify the API key works by fetching user info (v1 API)
    const response = await fetch('https://api.streak.com/api/v1/users/me', {
      headers: {
        'Authorization': `Basic ${btoa(state.streakApiKey + ':')}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Streak API error:', errorText);
      throw new Error(`Failed to verify Streak access: ${response.status}`);
    }

    const user = await response.json();
    console.log('Streak user response:', user);

    // If we got a valid user response, we have access
    // Note: v1 API may return email in a different field
    return user && (user.email === state.streakEmail || user.emailAddress === state.streakEmail);
  } catch (error) {
    console.error('Error verifying Streak access:', error);
    return false;
  }
}

async function searchStreakContact(phoneNumber) {
  // Check cache first
  if (state.contactCache[phoneNumber]) {
    return state.contactCache[phoneNumber];
  }

  try {
    // Clean phone number for search (remove +1, spaces, dashes)
    const cleanNumber = phoneNumber.replace(/[\s\-\+]/g, '').slice(-10);

    const response = await fetch(`https://api.streak.com/api/v1/search?query=${encodeURIComponent(cleanNumber)}`, {
      headers: {
        'Authorization': `Basic ${btoa(state.streakApiKey + ':')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to search Streak');
    }

    const results = await response.json();

    // Look for contact in results
    if (results.results && results.results.length > 0) {
      const contact = results.results[0];
      const contactInfo = {
        name: contact.displayName || contact.email || phoneNumber,
        boxKey: contact.boxKey,
        email: contact.email
      };

      // Cache the result
      state.contactCache[phoneNumber] = contactInfo;
      await chrome.storage.local.set({ contactCache: state.contactCache });

      return contactInfo;
    }

    return { name: phoneNumber, boxKey: null, email: null };
  } catch (error) {
    console.error('Error searching Streak:', error);
    return { name: phoneNumber, boxKey: null, email: null };
  }
}

async function getStreakBoxes() {
  try {
    // Get all pipelines the user has access to
    const response = await fetch('https://api.streak.com/api/v2/pipelines', {
      headers: {
        'Authorization': `Basic ${btoa(state.streakApiKey + ':')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch pipelines');
    }

    const pipelines = await response.json();

    // Get all boxes from all pipelines
    const allBoxes = [];
    for (const pipeline of pipelines) {
      const boxesResponse = await fetch(`https://api.streak.com/api/v2/pipelines/${pipeline.key}/boxes`, {
        headers: {
          'Authorization': `Basic ${btoa(state.streakApiKey + ':')}`
        }
      });

      if (boxesResponse.ok) {
        const boxes = await boxesResponse.json();
        allBoxes.push(...boxes);
      }
    }

    return allBoxes;
  } catch (error) {
    console.error('Error fetching Streak boxes:', error);
    return [];
  }
}

function extractPhoneNumbersFromBoxes(boxes) {
  const phoneNumbers = new Set();
  const phoneRegex = /(\+?1?\s*\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;

  boxes.forEach(box => {
    // Check box fields for phone numbers
    if (box.fields) {
      Object.values(box.fields).forEach(field => {
        if (typeof field === 'string') {
          const matches = field.match(phoneRegex);
          if (matches) {
            matches.forEach(match => {
              // Clean the phone number
              const cleaned = match.replace(/[\s\-\(\)\.]/g, '');
              if (cleaned.length >= 10) {
                phoneNumbers.add(cleaned);
              }
            });
          }
        }
      });
    }

    // Check notes for phone numbers
    if (box.notes) {
      const matches = box.notes.match(phoneRegex);
      if (matches) {
        matches.forEach(match => {
          const cleaned = match.replace(/[\s\-\(\)\.]/g, '');
          if (cleaned.length >= 10) {
            phoneNumbers.add(cleaned);
          }
        });
      }
    }
  });

  return Array.from(phoneNumbers);
}

// Backend API functions
async function callBackendAPI(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (state.apiKey) {
    headers['x-api-key'] = state.apiKey;
  }

  const response = await fetch(`${state.backendUrl}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}

async function loadConversations(filterByStreakBoxes = false, append = false) {
  try {
    showLoading(true);

    if (!append) {
      state.conversationOffset = 0;
      state.conversations = [];
    }

    let apiUrl = `/api/conversations?limit=${state.conversationLimit}`;

    // Optionally filter by phone numbers found in Streak boxes
    if (filterByStreakBoxes) {
      const boxes = await getStreakBoxes();
      const phoneNumbers = extractPhoneNumbersFromBoxes(boxes);

      if (phoneNumbers.length > 0) {
        apiUrl += `&phoneNumbers=${phoneNumbers.join(',')}`;
      }
    }

    const data = await callBackendAPI(apiUrl);

    if (append) {
      state.conversations.push(...data.conversations);
    } else {
      state.conversations = data.conversations;
    }

    // Check if there are more conversations to load
    state.hasMoreConversations = data.conversations.length >= state.conversationLimit;
    state.conversationOffset += data.conversations.length;

    // Enrich conversations with contact names from Streak
    for (const conv of state.conversations) {
      const phoneNumber = conv.participants.find(p => p.type === 'sms')?.address;
      if (phoneNumber) {
        const contact = await searchStreakContact(phoneNumber);
        conv.contactName = contact.name;
        conv.contactBoxKey = contact.boxKey;
        conv.contactEmail = contact.email;
      }
    }

    renderConversationList();
  } catch (error) {
    console.error('Error loading conversations:', error);
    showToast('Failed to load conversations. Please check your backend connection.', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadMessages(conversationSid, silent = false) {
  try {
    const data = await callBackendAPI(`/api/messages?conversationSid=${conversationSid}`);
    const previousMessageCount = state.messages.length;
    state.messages = data.messages;
    renderMessages();

    // Show notification if new messages arrived (only during auto-refresh)
    if (silent && data.messages.length > previousMessageCount) {
      const newCount = data.messages.length - previousMessageCount;
      showToast(`${newCount} new message${newCount > 1 ? 's' : ''} received`, 'info', 2000);
    }
  } catch (error) {
    console.error('Error loading messages:', error);
    if (!silent) {
      showToast('Failed to load messages. Please try again.', 'error');
    }
  }
}

function startAutoRefresh() {
  stopAutoRefresh();

  if (state.autoRefreshEnabled && state.currentConversation) {
    // Refresh messages every 5 seconds
    state.autoRefreshInterval = setInterval(() => {
      if (state.currentConversation) {
        loadMessages(state.currentConversation.sid, true);
      }
    }, 5000);
  }
}

function stopAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
  }
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !state.currentConversation) return;

  try {
    sendBtn.disabled = true;

    await callBackendAPI('/api/send-message', {
      method: 'POST',
      body: JSON.stringify({
        conversationSid: state.currentConversation.sid,
        message: message,
        author: state.streakEmail
      })
    });

    messageInput.value = '';

    // Reload messages to show the sent message
    await loadMessages(state.currentConversation.sid);
    showToast('Message sent successfully', 'success');
  } catch (error) {
    console.error('Error sending message:', error);
    showToast('Failed to send message. Please check your connection and try again.', 'error');
  } finally {
    sendBtn.disabled = false;
  }
}

// UI Rendering
function showLoading(show) {
  if (show) {
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

function renderConversationList() {
  conversationList.innerHTML = '';

  if (state.conversations.length === 0) {
    conversationList.innerHTML = `
      <div class="empty-state">
        <h3>No conversations found</h3>
        <p>Conversations will appear here when available</p>
      </div>
    `;
    loadMoreContainer.classList.add('hidden');
    return;
  }

  state.conversations.forEach(conv => {
    const phoneNumber = conv.participants.find(p => p.type === 'sms')?.address || 'Unknown';
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.innerHTML = `
      <div class="conversation-name">${conv.contactName || 'Unknown Contact'}</div>
      <div class="conversation-phone">${phoneNumber}</div>
      <div class="conversation-time">${formatDate(conv.dateUpdated)}</div>
    `;

    item.addEventListener('click', () => selectConversation(conv));
    conversationList.appendChild(item);
  });

  // Show/hide load more button
  if (state.hasMoreConversations) {
    loadMoreContainer.classList.remove('hidden');
  } else {
    loadMoreContainer.classList.add('hidden');
  }
}

function selectConversation(conversation) {
  state.currentConversation = conversation;

  // Update UI
  document.getElementById('thread-name').textContent = conversation.contactName || 'Unknown Contact';
  const phoneNumber = conversation.participants.find(p => p.type === 'sms')?.address || 'Unknown';
  document.getElementById('thread-phone').textContent = phoneNumber;

  // Show/hide Streak button based on whether we have a box key
  if (conversation.contactBoxKey) {
    openStreakBtn.classList.remove('hidden');
    openStreakBtn.onclick = () => {
      window.open(`https://app.streak.com/box/${conversation.contactBoxKey}`, '_blank');
    };
  } else {
    openStreakBtn.classList.add('hidden');
  }

  conversationList.classList.add('hidden');
  loadMoreContainer.classList.add('hidden');
  messageThread.classList.remove('hidden');

  loadMessages(conversation.sid);
  startAutoRefresh();
}

function renderMessages() {
  messagesContainer.innerHTML = '';

  if (state.messages.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state">
        <p>No messages yet</p>
      </div>
    `;
    return;
  }

  state.messages.forEach(msg => {
    const isOutgoing = msg.author === state.streakEmail || msg.author === 'system';
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    messageEl.innerHTML = `
      <div class="message-body">${escapeHtml(msg.body)}</div>
      <div class="message-time">${formatDate(msg.dateCreated)}</div>
    `;
    messagesContainer.appendChild(messageEl);
  });

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Utility functions
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event Listeners
loginBtn.addEventListener('click', async () => {
  const email = document.getElementById('streak-email').value.trim();
  const apiKey = document.getElementById('streak-api-key').value.trim();
  const backendUrl = document.getElementById('backend-url').value.trim();
  const apiKeyInput = document.getElementById('api-key').value.trim();

  if (!email || !apiKey || !backendUrl) {
    showError('Please fill in all required fields');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Verifying...';

  state.streakEmail = email;
  state.streakApiKey = apiKey;
  state.backendUrl = backendUrl.replace(/\/$/, ''); // Remove trailing slash
  state.apiKey = apiKeyInput || null;

  const hasAccess = await verifyStreakAccess();

  if (hasAccess) {
    // Save credentials
    await chrome.storage.local.set({
      streakEmail: state.streakEmail,
      streakApiKey: state.streakApiKey,
      backendUrl: state.backendUrl,
      apiKey: state.apiKey
    });

    showMainScreen();
    await loadConversations();
  } else {
    showError('Unable to verify Streak access. Please check your credentials and ensure you have Owner or Member access.');
  }

  loginBtn.disabled = false;
  loginBtn.textContent = 'Login';
});

logoutBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to logout?')) {
    await chrome.storage.local.clear();
    state.streakEmail = null;
    state.streakApiKey = null;
    state.backendUrl = null;
    state.apiKey = null;
    state.conversations = [];
    state.currentConversation = null;
    state.messages = [];
    showLoginScreen();
  }
});

backBtn.addEventListener('click', () => {
  stopAutoRefresh();
  state.currentConversation = null;
  state.messages = [];
  conversationList.classList.remove('hidden');
  messageThread.classList.add('hidden');

  // Show load more button if applicable
  if (state.hasMoreConversations) {
    loadMoreContainer.classList.remove('hidden');
  }
});

refreshBtn.addEventListener('click', async () => {
  const filterEnabled = filterByStreakCheckbox.checked;
  await loadConversations(filterEnabled);
});

filterByStreakCheckbox.addEventListener('change', async () => {
  const filterEnabled = filterByStreakCheckbox.checked;
  await loadConversations(filterEnabled);
});

loadMoreBtn.addEventListener('click', async () => {
  const filterEnabled = filterByStreakCheckbox.checked;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';
  await loadConversations(filterEnabled, true);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
});

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Initialize the app
init();
