import { randomUUID } from 'crypto';

type NotificationEvent = {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, any>;
};

const events: NotificationEvent[] = [];
const MAX_EVENTS = 200;

export function recordNotification(event: Omit<NotificationEvent, 'id' | 'timestamp'> & { timestamp?: string }) {
  const entry: NotificationEvent = {
    id: randomUUID(),
    type: event.type,
    timestamp: event.timestamp || new Date().toISOString(),
    payload: event.payload
  };

  events.push(entry);

  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  return entry;
}

export function getNotificationsSince(timestamp?: string | null) {
  if (!timestamp) {
    return [...events];
  }

  const since = new Date(timestamp);
  if (Number.isNaN(since.valueOf())) {
    return [...events];
  }

  return events.filter(event => new Date(event.timestamp) > since);
}
