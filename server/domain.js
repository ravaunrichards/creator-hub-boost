// Campaign catalogues use virtual coin pricing; no fixed TikTok metric delivery is sold.
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
    id: 'video-feedback-panel',
    name: 'Genuine audience feedback',
    category: 'Human feedback',
    description: 'Put your public TikTok video in front of real Creator Hub Boost members and receive reviewed, useful feedback. People decide independently whether they want to follow or engage; those actions are never required for a reward.',
    packages: [
      { id: 'feedback-5', label: '5 feedback responses', detail: 'Five independent human feedback submissions', coins: 250, responseCount: 5, rewardCoinsPerResponse: 30 },
      { id: 'feedback-15', label: '15 feedback responses', detail: 'Fifteen independent human feedback submissions', coins: 600, responseCount: 15, rewardCoinsPerResponse: 30 }
    ]
  },
  {
    id: 'caption-review',
    name: 'Creative & caption review',
    category: 'Creative research',
    description: 'Request real human feedback on a public video, its opening, clarity, accessibility, or caption. Participants earn coins for reviewed feedback—not for a required TikTok like, follow, comment, or share.',
    packages: [
      { id: 'creative-1', label: '1 structured review', detail: 'One independent feedback submission', coins: 200, responseCount: 1, rewardCoinsPerResponse: 100 },
      { id: 'creative-3', label: '3 structured reviews', detail: 'Three independent feedback submissions', coins: 450, responseCount: 3, rewardCoinsPerResponse: 100 }
    ]
  }
];

export function validateTikTokUrl(value) {
  const targetUrl = String(value ?? '').trim();
  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('Enter a valid public TikTok URL.'); }
  if (parsed.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(parsed.hostname) || parsed.username || parsed.password) {
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
  return { campaignId: campaign.id, campaignName: campaign.name, packageId: pack.id, packageLabel: pack.label, coinsCost: pack.coins, responseCount: pack.responseCount, rewardCoinsPerResponse: pack.rewardCoinsPerResponse, targetUrl };
}

export function paypalBaseUrl(env = process.env.PAYPAL_ENV) {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
