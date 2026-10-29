import { randomUUID } from 'node:crypto';

// Legacy cash catalogue retained for backwards-compatible domain tests/API consumers.
export const SERVICES = [
  { id: 'video-views', name: 'Video discovery campaign', category: 'Views', description: 'Promote eligible public videos to reach more real viewers.', packages: [{ id: 'views-1k', label: '1,000 views', price: 2.99 }, { id: 'views-5k', label: '5,000 views', price: 9.99 }, { id: 'views-10k', label: '10,000 views', price: 17.99 }] },
  { id: 'video-likes', name: 'Video feedback campaign', category: 'Likes', description: 'Request genuine feedback on eligible public content.', packages: [{ id: 'likes-100', label: 'Feedback starter', price: 2.49 }, { id: 'likes-500', label: 'Feedback plus', price: 8.99 }, { id: 'likes-1k', label: 'Feedback pro', price: 14.99 }] },
  { id: 'profile-reach', name: 'Profile discovery campaign', category: 'Profile', description: 'Improve discovery of a public creator profile; results are not guaranteed.', packages: [{ id: 'profile-basic', label: 'Starter campaign', price: 4.99 }, { id: 'profile-plus', label: 'Growth campaign', price: 12.99 }, { id: 'profile-pro', label: 'Extended campaign', price: 24.99 }] },
  { id: 'video-shares', name: 'Content discovery campaign', category: 'Shares', description: 'Request compliant discovery for a public video link.', packages: [{ id: 'shares-50', label: 'Discovery starter', price: 3.99 }, { id: 'shares-250', label: 'Discovery plus', price: 12.99 }] }
];

export const COIN_PACKAGES = [
  { id: 'coins-500', name: 'Starter', coins: 500, price: 4.99, currency: 'USD', popular: false },
  { id: 'coins-1200', name: 'Creator', coins: 1200, price: 9.99, currency: 'USD', popular: true },
  { id: 'coins-3000', name: 'Growth', coins: 3000, price: 19.99, currency: 'USD', popular: false },
  { id: 'coins-8000', name: 'Studio', coins: 8000, price: 49.99, currency: 'USD', popular: false }
];

export const TASK_SEEDS = [
  { id: 'video-feedback', title: 'Public video feedback', description: 'Help a creator improve their public video with useful, specific feedback.', instructions: 'Review the public video, then write constructive notes about its opening, clarity, pacing, or accessibility. Do not follow, like, comment for metric manipulation, or promise engagement.', rewardCoins: 25, taskType: 'content_feedback' },
  { id: 'profile-feedback', title: 'Creator profile review', description: 'Give a creator practical ideas to make their public profile easier to understand.', instructions: 'Review the creator bio, profile presentation, and content themes. Suggest one or two improvements. Do not exchange follows or ask for artificial engagement.', rewardCoins: 30, taskType: 'profile_feedback' },
  { id: 'caption-feedback', title: 'Caption idea review', description: 'Suggest a clear, original caption angle for a public creator video.', instructions: 'Review the linked content and write an original caption suggestion that accurately describes it. Do not submit spam or misleading claims.', rewardCoins: 20, taskType: 'creative_feedback' },
  { id: 'accessibility-review', title: 'Accessibility check', description: 'Help a creator make public content easier for more people to follow.', instructions: 'Review the linked video and identify a practical accessibility improvement, such as clearer on-screen text, captions, or contrast. Do not download or re-upload someone else’s content.', rewardCoins: 35, taskType: 'accessibility_feedback' }
];

export const CAMPAIGNS = [
  {
    id: 'creator-spotlight',
    name: 'Creator discovery spotlight',
    category: 'Discovery',
    description: 'Request placement for your public creator profile in Creator Hub Boost discovery areas. This is on-platform promotion, not a promise of TikTok followers or likes.',
    packages: [
      { id: 'spotlight-1day', label: '1-day spotlight', detail: 'One day of eligible in-app placement', coins: 150 },
      { id: 'spotlight-3day', label: '3-day spotlight', detail: 'Three days of eligible in-app placement', coins: 350 },
      { id: 'spotlight-7day', label: '7-day spotlight', detail: 'Seven days of eligible in-app placement', coins: 700 }
    ]
  },
  {
    id: 'video-feedback-panel',
    name: 'Real-audience feedback panel',
    category: 'Feedback',
    description: 'Collect useful human feedback about your public video from eligible platform participants. No purchased likes, follows, or artificial metric guarantees.',
    packages: [
      { id: 'feedback-5', label: '5 feedback responses', detail: 'Request five relevant feedback responses', coins: 250 },
      { id: 'feedback-15', label: '15 feedback responses', detail: 'Request fifteen relevant feedback responses', coins: 600 }
    ]
  },
  {
    id: 'caption-review',
    name: 'Caption & creative review',
    category: 'Creative',
    description: 'Request review of a public video caption or creative presentation to help improve clarity and audience fit.',
    packages: [
      { id: 'creative-1', label: 'Single review', detail: 'One structured creative review', coins: 200 },
      { id: 'creative-3', label: 'Three reviews', detail: 'Three independent creative reviews', coins: 450 }
    ]
  }
];

export function validateTikTokUrl(value) {
  const targetUrl = String(value ?? '').trim();
  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('Enter a valid public TikTok URL.'); }
  if (parsed.protocol !== 'https:' || !/(^|\\.)tiktok\\.com$/i.test(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('Use an HTTPS public TikTok URL hosted on tiktok.com.');
  }
  return targetUrl;
}

export function validateTaskSubmission(input, taskIds = TASK_SEEDS.map(task => task.id)) {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskIds.includes(taskId)) throw new Error('Choose a valid active task.');
  const targetUrl = validateTikTokUrl(input.targetUrl);
  const responseText = String(input.responseText ?? '').trim();
  if (responseText.length < 20 || responseText.length > 3000) throw new Error('Write feedback between 20 and 3,000 characters.');
  return { taskId, targetUrl, responseText };
}

export function validateCampaignOrder(input, campaigns = CAMPAIGNS) {
  const campaign = campaigns.find(item => item.id === input.campaignId);
  if (!campaign) throw new Error('Choose a valid campaign.');
  const pack = campaign.packages.find(item => item.id === input.packageId);
  if (!pack) throw new Error('Choose a valid campaign package.');
  const targetUrl = validateTikTokUrl(input.targetUrl);
  if (input.policyAccepted !== true) throw new Error('Confirm that you own or are authorized to promote this public content.');
  return { campaignId: campaign.id, campaignName: campaign.name, packageId: pack.id, packageLabel: pack.label, coinsCost: pack.coins, targetUrl };
}

export function validateOrder(input) {
  const service = SERVICES.find(s => s.id === input.serviceId);
  if (!service) throw new Error('Choose a valid service.');
  const pack = service.packages.find(p => p.id === input.packageId);
  if (!pack) throw new Error('Choose a valid package.');
  const targetUrl = validateTikTokUrl(input.targetUrl);
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (input.policyAccepted !== true) throw new Error('Confirm that you own or are authorized to promote this public content.');
  return { id: randomUUID(), serviceId: service.id, serviceName: service.name, packageId: pack.id, packageLabel: pack.label, amount: pack.price, currency: 'USD', targetUrl, email, status: 'awaiting_payment', createdAt: new Date().toISOString() };
}

export function paypalBaseUrl(env = process.env.PAYPAL_ENV) {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
