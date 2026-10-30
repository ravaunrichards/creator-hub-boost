export const SERVICE_CATALOGUE = [
  {
    id: 'profile-review',
    name: 'Profile review',
    category: 'Profile',
    targetType: 'profile',
    description: 'A practical audit of profile clarity, positioning, bio, first impression, and content presentation.',
    packages: [
      { id: 'profile-quick', label: 'Quick profile review', quantity: 1, price: 4.99, currency: 'USD', deliverable: 'A written review with five specific improvements.' },
      { id: 'profile-creator', label: 'Creator profile audit', quantity: 1, price: 9.99, currency: 'USD', deliverable: 'A deeper profile audit with prioritized recommendations.' },
      { id: 'profile-deep', label: 'Complete profile strategy', quantity: 1, price: 19.99, currency: 'USD', deliverable: 'A full profile positioning and content-presentation report.' }
    ]
  },
  {
    id: 'video-review',
    name: 'Video review',
    category: 'Video',
    targetType: 'video',
    description: 'A constructive review of the opening, clarity, pacing, story, captions, and creative presentation of your video.',
    packages: [
      { id: 'video-one', label: 'One video review', quantity: 1, price: 3.99, currency: 'USD', deliverable: 'A structured written critique of one public video.' },
      { id: 'video-three', label: 'Three video reviews', quantity: 3, price: 9.99, currency: 'USD', deliverable: 'Structured written critiques of three public videos.' },
      { id: 'video-five', label: 'Five video reviews', quantity: 5, price: 14.99, currency: 'USD', deliverable: 'A five-video review set with recurring improvement themes.' }
    ]
  },
  {
    id: 'growth-plan',
    name: 'Creator growth plan',
    category: 'Strategy',
    targetType: 'profile',
    description: 'A realistic content plan based on your public profile, audience positioning, and creative goals.',
    packages: [
      { id: 'growth-starter', label: 'Starter action plan', quantity: 1, price: 7.99, currency: 'USD', deliverable: 'A concise list of practical next steps for your creator profile.' },
      { id: 'growth-week', label: 'Seven-day content plan', quantity: 7, price: 14.99, currency: 'USD', deliverable: 'A seven-day content outline with hooks and topic prompts.' },
      { id: 'growth-month', label: 'Thirty-day content plan', quantity: 30, price: 29.99, currency: 'USD', deliverable: 'A thirty-day content strategy with weekly themes and ideas.' }
    ]
  },
  {
    id: 'content-readiness',
    name: 'Content readiness review',
    category: 'Creative',
    targetType: 'video',
    description: 'Review the clarity, accessibility, caption, hook, and share-readiness of a public video without promising engagement metrics.',
    packages: [
      { id: 'readiness-one', label: 'One content review', quantity: 1, price: 3.99, currency: 'USD', deliverable: 'A focused readiness and accessibility checklist.' },
      { id: 'readiness-three', label: 'Three content reviews', quantity: 3, price: 8.99, currency: 'USD', deliverable: 'Three content-readiness checklists with prioritized changes.' },
      { id: 'readiness-five', label: 'Five content reviews', quantity: 5, price: 12.99, currency: 'USD', deliverable: 'Five reviews covering creative clarity, captions, and accessibility.' }
    ]
  }
];

export function findServicePackage(serviceId, packageId) {
  const service = SERVICE_CATALOGUE.find(item => item.id === serviceId);
  const pack = service?.packages.find(item => item.id === packageId);
  return service && pack ? { service, pack } : null;
}
