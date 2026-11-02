export interface TabReminder {
  id: string;              // Unique ID: `rem_${Date.now()}`
  targetType: 'bookmark' | 'tab';
  bookmarkId?: string;     // Set if attached to a Workspace / Quick Access bookmark
  tabId?: number;          // Set if attached to an open tab
  url: string;             // Normalized URL (used to re-open tab if closed before alarm fires)
  title: string;           // Page/Bookmark title at creation time
  note: string;            // User's short reminder message
  triggerAt: number;       // Unix timestamp in ms
  status: 'scheduled' | 'fired'; // 'fired' means due/overdue and awaiting user dismissal
  createdAt: number;
}
