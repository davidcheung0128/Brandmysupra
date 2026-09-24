export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function isCompanyEmail(value) {
  const email = value.trim().toLowerCase();
  const match = email.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  return Boolean(match && !PERSONAL_EMAIL_DOMAINS.has(match[1]));
}

export function nextBidForSlots(slotIds, slots, bids) {
  return slotIds.reduce((total, id) => total + bids[id] + slots[id].increment, 0);
}

export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
