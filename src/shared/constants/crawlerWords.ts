/**
 * The Knowledge Gather Agent's default word lists — editable in Configuration → Knowledge bases → Crawler settings,
 * for sites in any language.
 */

/** Words and phrases of controls that delete, save, send, pay or sign out — the default, editable in the settings. */
export const DEFAULT_ASK_WORDS = [
  'log out', 'logout', 'sign out', 'signout', 'log off', 'end session',
  'delete', 'remove', 'erase', 'destroy', 'trash', 'purge', 'wipe',
  'pay', 'payment', 'purchase', 'buy', 'checkout', 'check out', 'place order', 'order now', 'subscribe', 'donate', 'refund', 'charge',
  'send', 'submit', 'publish', 'post', 'invite', 'forward', 'reply',
  'save', 'update', 'confirm', 'approve', 'reject', 'decline', 'accept', 'e-sign', 'finalise', 'finalize', 'complete', 'finish', 'commit',
  'book now', 'book appointment', 'reserve', 'register', 'enrol', 'enroll',
  'cancel appointment', 'cancel order', 'cancel booking', 'cancel subscription', 'close account',
  'deactivate', 'disable', 'archive', 'discard', 'reset', 'revoke', 'block', 'ban', 'suspend', 'terminate', 'void', 'transfer', 'merge', 'import', 'upload', 'restore', 'mark as',
];

/**
 * Words of controls that move through the same list or calendar, or fold a panel — clicking them shows no new
 * screen of the site, only other rows or another week. The default, editable in the settings.
 */
export const DEFAULT_SAME_SCREEN_WORDS = [
  'next', 'previous', 'prev', 'back', 'forward', 'today', 'now', 'day', 'week', 'month', 'year', 'first', 'last', 'older', 'newer',
  'more', 'less', 'show more', 'show less', 'load more', 'toggle sidebar', 'collapse', 'expand', 'menu', 'hamburger', 'close sidebar', 'open sidebar',
];
