// Application state
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const AUTO_REFRESH_INTERVAL_MS = 15000;

let imageObserver = null;

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
  autoRefreshEnabled: true,
  pendingMedia: [],
  pendingConversationSid: null,
  isLoadingConversations: false
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
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const loadMoreBtn = document.getElementById('load-more-btn');
const loadMoreContainer = document.getElementById('load-more-container');
const addMediaBtn = document.getElementById('add-media-btn');
const mediaInput = document.getElementById('media-input');
const attachmentPreview = document.getElementById('attachment-preview');

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
    const response = await fetch(`https://api.streak.com/api/v1/search?query=${encodeURIComponent(phoneNumber)}`, {
      headers: {
        'Authorization': `Basic ${btoa(state.streakApiKey + ':')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to search Streak');
    }

    const data = await response.json();

    // Check if we have contacts in the results
    if (data.results && data.results.contacts && data.results.contacts.length > 0) {
      const contact = data.results.contacts[0];
      const fullName = [contact.givenName, contact.familyName].filter(Boolean).join(' ');

      const contactInfo = {
        name: fullName || contact.emailAddresses?.[0] || phoneNumber,
        boxKey: contact.key,
        email: contact.emailAddresses?.[0] || null,
        givenName: contact.givenName,
        familyName: contact.familyName
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

// Backend API functions
async function callBackendAPI(endpoint, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...options.headers
  };

  if (!isFormData) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (state.apiKey) {
    headers['x-api-key'] = state.apiKey;
  }

  const response = await fetch(`${state.backendUrl}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let errorMessage = 'API request failed';
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorMessage;
    } catch (err) {
      // ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function buildMediaUrl(url) {
  if (!url || !state.apiKey) {
    return url;
  }

  try {
    const parsedUrl = new URL(url, state.backendUrl || undefined);
    parsedUrl.searchParams.set('apiKey', state.apiKey);
    return parsedUrl.toString();
  } catch (error) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}apiKey=${encodeURIComponent(state.apiKey)}`;
  }
}

async function loadConversations(append = false) {
  if (state.isLoadingConversations) {
    return;
  }

  try {
    state.isLoadingConversations = true;
    showLoading(true);

    if (!append) {
      state.conversationOffset = 0;
      state.conversations = [];
    }

    let apiUrl = `/api/conversations?limit=${state.conversationLimit}`;

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
    tryOpenPendingConversation();
  } catch (error) {
    console.error('Error loading conversations:', error);
    showToast('Failed to load conversations. Please check your backend connection.', 'error');
  } finally {
    state.isLoadingConversations = false;
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
    // Refresh messages on interval
    state.autoRefreshInterval = setInterval(() => {
      if (state.currentConversation) {
        loadMessages(state.currentConversation.sid, true);
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  }
}

function stopAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopAutoRefresh();
  } else if (state.currentConversation) {
    startAutoRefresh();
  }
}

async function sendMessage() {
  if (!state.currentConversation) return;

  const message = messageInput.value.trim();
  const hasMedia = state.pendingMedia.length > 0;

  if (!message && !hasMedia) return;

  try {
    sendBtn.disabled = true;
    if (addMediaBtn) {
      addMediaBtn.disabled = true;
    }
    sendBtn.textContent = 'Sending...';

    if (hasMedia) {
      const formData = new FormData();
      formData.append('conversationSid', state.currentConversation.sid);
      formData.append('author', state.streakEmail);
      if (message) {
        formData.append('message', message);
      }

      state.pendingMedia.forEach(file => {
        formData.append('media', file, file.name);
      });

      await callBackendAPI('/api/send-message', {
        method: 'POST',
        body: formData
      });
    } else {
      await callBackendAPI('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({
          conversationSid: state.currentConversation.sid,
          message: message,
          author: state.streakEmail
        })
      });
    }

    resetComposer();

    // Reload messages to show the sent message
    await loadMessages(state.currentConversation.sid);
    showToast('Message sent successfully', 'success');
  } catch (error) {
    console.error('Error sending message:', error);
    showToast(error.message || 'Failed to send message. Please check your connection and try again.', 'error');
  } finally {
    sendBtn.disabled = false;
    if (addMediaBtn) {
      addMediaBtn.disabled = false;
    }
    sendBtn.textContent = 'Send';
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

async function renderConversationList() {
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

  // Get unread conversations list
  const saved = await chrome.storage.local.get(['unreadConversations']);
  const unreadConversations = new Set(saved.unreadConversations || []);

  state.conversations.forEach(conv => {
    const phoneNumber = conv.participants.find(p => p.type === 'sms')?.address || 'Unknown';
    const item = document.createElement('div');
    item.className = 'conversation-item';

    // Check if conversation is in the unread list
    const isUnread = unreadConversations.has(conv.sid);

    if (isUnread) {
      item.classList.add('unread');
    }

    item.innerHTML = `
      <div class="conversation-name">${conv.contactName || 'Unknown Contact'}${isUnread ? ' <span class="unread-indicator">●</span>' : ''}</div>
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
  resetComposer();

  // Update UI
  document.getElementById('thread-name').textContent = conversation.contactName || 'Unknown Contact';
  const phoneNumber = conversation.participants.find(p => p.type === 'sms')?.address || 'Unknown';
  document.getElementById('thread-phone').textContent = phoneNumber;

  // Show/hide Streak button based on whether we have a box key
  if (conversation.contactBoxKey) {
    openStreakBtn.classList.remove('hidden');
    openStreakBtn.onclick = () => {
      window.open(`https://mail.google.com/mail/u/0/#box/${conversation.contactBoxKey}`, '_blank');
    };
  } else {
    openStreakBtn.classList.add('hidden');
  }

  conversationList.classList.add('hidden');
  loadMoreContainer.classList.add('hidden');
  messageThread.classList.remove('hidden');

  // Notify background script that conversation was opened (mark as read)
  chrome.runtime.sendMessage({
    type: 'MARK_CONVERSATION_READ',
    conversationSid: conversation.sid
  });

  loadMessages(conversation.sid);
  startAutoRefresh();
}

function tryOpenPendingConversation() {
  if (!state.pendingConversationSid) return;
  const pending = state.conversations.find(conv => conv.sid === state.pendingConversationSid);
  if (pending) {
    selectConversation(pending);
    state.pendingConversationSid = null;
  }
}

function focusConversationBySid(conversationSid) {
  if (!conversationSid) return;
  const existing = state.conversations.find(conv => conv.sid === conversationSid);
  if (existing) {
    selectConversation(existing);
    state.pendingConversationSid = null;
    return;
  }

  state.pendingConversationSid = conversationSid;
  if (!state.isLoadingConversations) {
    loadConversations();
  }
}

function getImageObserver() {
  if (typeof IntersectionObserver === 'undefined') {
    return null;
  }

  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }

  imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const imgElement = entry.target;
      const data = imgElement.dataset;
      if (!data || !data.src) return;

      imageObserver.unobserve(imgElement);

      const placeholder = data.placeholder ? document.getElementById(data.placeholder) : null;

      imgElement.onload = () => {
        imgElement.style.display = 'block';
        if (placeholder) {
          placeholder.style.display = 'none';
        }
      };

      imgElement.onerror = () => {
        if (placeholder) {
          placeholder.innerHTML = `📷 <a href="${data.src}" target="_blank">${data.filename || 'Image'}</a> (failed to load)`;
        }
      };

      imgElement.src = data.src;
    });
  }, {
    root: messagesContainer,
    rootMargin: '200px 0px',
    threshold: 0.01
  });

  return imageObserver;
}

function renderMessages() {
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }

  messagesContainer.innerHTML = '';

  if (state.messages.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state">
        <p>No messages yet</p>
      </div>
    `;
    return;
  }

  let imageIndex = 0;
  const imagesToLoad = [];

  state.messages.forEach(msg => {
    const isOutgoing = msg.author === state.streakEmail || msg.author === 'system';
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;

    let messageContent = '';

    // Add media (images) if present
    if (msg.media && msg.media.length > 0) {
      msg.media.forEach(mediaItem => {
        if (mediaItem.contentType && mediaItem.contentType.startsWith('image/')) {
          // Create a placeholder for the image that will be loaded progressively
          const imgId = `lazy-img-${imageIndex++}`;
          messageContent += `<img id="${imgId}" class="message-image" alt="${mediaItem.filename || 'Image'}" style="display:none;" />`;
          messageContent += `<div id="${imgId}-placeholder" class="message-media-other">📷 Loading image...</div>`;
          imagesToLoad.push({ imgId, url: mediaItem.url, filename: mediaItem.filename });
        } else if (mediaItem.contentType) {
          // Show other media types as download links
          messageContent += `<div class="message-media-other">📎 <a href="${mediaItem.url}" target="_blank">${mediaItem.filename || 'Media file'}</a> (${mediaItem.contentType})</div>`;
        }
      });
    }

    // Add text body if present
    if (msg.body) {
      messageContent += `<div class="message-body">${escapeHtml(msg.body)}</div>`;
    }

    // Determine sender name for the timestamp
    let senderName = '';
    if (isOutgoing) {
      // For outgoing messages, use the Streak email or first name
      if (msg.author === state.streakEmail) {
        // Extract first name from email if possible
        const emailName = msg.author.split('@')[0].split('.').map(part =>
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join(' ');
        senderName = emailName;
      } else {
        senderName = msg.author;
      }
    } else {
      // For incoming messages, use the contact name if available
      senderName = state.currentConversation?.contactName || 'Contact';
    }

    messageContent += `<div class="message-time">${formatDate(msg.dateCreated)} from ${escapeHtml(senderName)}</div>`;

    messageEl.innerHTML = messageContent;
    messagesContainer.appendChild(messageEl);
  });

  lazyLoadImages(imagesToLoad);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function lazyLoadImages(imagesToLoad) {
  if (!imagesToLoad.length) return;

  const observer = getImageObserver();
  imagesToLoad.forEach(imageInfo => {
    const imgElement = document.getElementById(imageInfo.imgId);
    const placeholderElement = document.getElementById(`${imageInfo.imgId}-placeholder`);

    if (!imgElement || !placeholderElement) return;

    if (!observer) {
      imgElement.onload = () => {
        imgElement.style.display = 'block';
        placeholderElement.style.display = 'none';
      };
      imgElement.onerror = () => {
        placeholderElement.innerHTML = `📷 <a href="${imageInfo.url}" target="_blank">${imageInfo.filename || 'Image'}</a> (failed to load)`;
      };
      imgElement.src = imageInfo.url;
      return;
    }

    imgElement.dataset.src = imageInfo.url;
    imgElement.dataset.placeholder = placeholderElement.id;
    imgElement.dataset.filename = imageInfo.filename || '';
    observer.observe(imgElement);
  });
}

function renderAttachmentPreview() {
  if (!attachmentPreview) return;

  attachmentPreview.innerHTML = '';

  if (!state.pendingMedia.length) {
    attachmentPreview.classList.add('hidden');
    return;
  }

  attachmentPreview.classList.remove('hidden');

  state.pendingMedia.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.innerHTML = `
      <span class="attachment-chip__icon">📎</span>
      <span class="attachment-chip__name">${escapeHtml(file.name || `Attachment ${index + 1}`)}</span>
      <span class="attachment-chip__size">${formatFileSize(file.size)}</span>
      <button class="attachment-chip__remove" data-index="${index}" type="button" aria-label="Remove attachment">&times;</button>
    `;
    attachmentPreview.appendChild(chip);
  });

  attachmentPreview.querySelectorAll('.attachment-chip__remove').forEach(button => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget;
      const idx = Number(target.getAttribute('data-index'));
      if (!Number.isNaN(idx)) {
        state.pendingMedia.splice(idx, 1);
        renderAttachmentPreview();
      }
    });
  });
}

function clearPendingMedia() {
  state.pendingMedia = [];
  if (mediaInput) {
    mediaInput.value = '';
  }
  renderAttachmentPreview();
}

function resetComposer() {
  if (messageInput) {
    messageInput.value = '';
  }
  clearPendingMedia();
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

function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
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
    resetComposer();
    showLoginScreen();
  }
});

backBtn.addEventListener('click', () => {
  stopAutoRefresh();
  state.currentConversation = null;
  state.messages = [];
  resetComposer();
  conversationList.classList.remove('hidden');
  messageThread.classList.add('hidden');

  // Show load more button if applicable
  if (state.hasMoreConversations) {
    loadMoreContainer.classList.remove('hidden');
  }
});

refreshBtn.addEventListener('click', async () => {
  await loadConversations();
});

loadMoreBtn.addEventListener('click', async () => {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';
  await loadConversations(true);
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
});

if (addMediaBtn && mediaInput) {
  addMediaBtn.addEventListener('click', () => {
    if (!state.currentConversation) {
      showToast('Select a conversation before attaching media.', 'info');
      return;
    }
    mediaInput.click();
  });

  mediaInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    let combinedSize = state.pendingMedia.reduce((sum, file) => sum + file.size, 0);
    const acceptedFiles = [];

    for (const file of files) {
      if (combinedSize + file.size > MAX_ATTACHMENT_BYTES) {
        showToast(`Attachments limited to ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)} MB per message.`, 'error');
        break;
      }
      acceptedFiles.push(file);
      combinedSize += file.size;
    }

    if (acceptedFiles.length) {
      state.pendingMedia.push(...acceptedFiles);
      renderAttachmentPreview();
    }

    mediaInput.value = '';
  });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Initialize the app
init();

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('beforeunload', stopAutoRefresh);

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'FOCUS_CONVERSATION' && request.conversationSid) {
      focusConversationBySid(request.conversationSid);
    }
  });
}
