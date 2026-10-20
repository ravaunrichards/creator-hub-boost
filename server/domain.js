import { randomUUID } from 'node:crypto';

export const SERVICES = [
  { id: 'video-views', name: 'Video views campaign', category: 'Views', description: 'Promote eligible public videos to reach more real viewers.', packages: [{ id: 'views-1k', label: '1,000 views', price: 2.99 }, { id: 'views-5k', label: '5,000 views', price: 9.99 }, { id: 'views-10k', label: '10,000 views', price: 17.99 }] },
  { id: 'video-likes', name: 'Video engagement campaign', category: 'Likes', description: 'A campaign request for eligible public video engagement.', packages: [{ id: 'likes-100', label: '100 likes', price: 2.49 }, { id: 'likes-500', label: '500 likes', price: 8.99 }, { id: 'likes-1k', label: '1,000 likes', price: 14.99 }] },
  { id: 'profile-reach', name: 'Profile discovery campaign', category: 'Profile', description: 'Improve discovery of a public creator profile; results are not guaranteed.', packages: [{ id: 'profile-basic', label: 'Starter campaign', price: 4.99 }, { id: 'profile-plus', label: 'Growth campaign', price: 12.99 }, { id: 'profile-pro', label: 'Extended campaign', price: 24.99 }] },
  { id: 'video-shares', name: 'Video sharing campaign', category: 'Shares', description: 'Request a compliant campaign for a public video link.', packages: [{ id: 'shares-50', label: '50 shares', price: 3.99 }, { id: 'shares-250', label: '250 shares', price: 12.99 }] }
];

export function validateOrder(input) {
  const service = SERVICES.find(s => s.id === input.serviceId);
  if (!service) throw new Error('Choose a valid service.');
  const pack = service.packages.find(p => p.id === input.packageId);
  if (!pack) throw new Error('Choose a valid package.');
  const targetUrl = String(input.targetUrl ?? '').trim();
  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('Enter a valid public profile or video URL.'); }
  if (parsed.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(parsed.hostname)) throw new Error('Use a public TikTok URL beginning with https:// and hosted on tiktok.com.');
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (input.policyAccepted !== true) throw new Error('Confirm that you own or are authorized to promote this public content.');
  return { id: randomUUID(), serviceId: service.id, serviceName: service.name, packageId: pack.id, packageLabel: pack.label, amount: pack.price, currency: 'USD', targetUrl, email, status: 'awaiting_payment', createdAt: new Date().toISOString() };
}

export function paypalBaseUrl(env = process.env.PAYPAL_ENV) {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
