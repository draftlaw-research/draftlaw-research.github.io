// One place for the facts that appear all over the site.
export const SITE = {
  name: 'DraftLaw Research',
  tagline: 'Legal scholarship, open to everyone',
  motto: "mentoring tomorrow's legal scholars",
  description:
    'A nonprofit initiative that opens academic publishing to law students and emerging researchers through co-authorship mentorship and an open, peer-reviewed legal writing platform.',
  url: 'https://draftlawresearch.org',
  email: 'draftlawresearch@gmail.com', // general contact
  submissionEmail: 'submission.draftlaw@gmail.com', // where articles are sent
  location: 'Based in Sweden, working internationally',
  rights: 'Copyright remains with the authors unless stated otherwise.',
};

// Main menu. "match" lists the address prefixes that should highlight the item.
export const NAV = [
  { href: '/articles/', label: 'Articles', match: ['/articles/', '/authors/'] },
  { href: '/topics/', label: 'Topics', match: ['/topics/'] },
  { href: '/guidance/', label: 'Guidelines and Guidance', match: ['/guidance/'],},
  { href: '/newsletter/', label: 'Newsletter', match: ['/newsletter/'] },
  { href: '/programs/', label: 'Programs', match: ['/programs/'] },
  { href: '/submit/', label: 'Write with us', match: ['/submit/'] },
  { href: '/about/', label: 'About', match: ['/about/', '/team/'] },
];

// Footer: "Explore" shortcuts. Add or remove lines freely.
export const EXPLORE = [
  { href: '/articles/', label: 'Articles' },
  { href: '/topics/', label: 'Topics' },
  { href: '/authors/', label: 'Authors' },
  { href: '/newsletter/', label: 'Newsletter' },
  { href: '/programs/', label: 'Programs' },
  { href: '/programs/announcements/', label: 'Announcements' },
  { href: '/submit/', label: 'Write with us' },
  { href: '/about/', label: 'About us' },
  { href: '/about/#team', label: 'Our team' },
  { href: '/search/', label: 'Search' },
];

// Footer: social media. A line with an empty url is hidden, so add the address when you have it.
export const SOCIALS = [
  { label: 'LinkedIn', url: 'https://www.linkedin.com/company/draftlaw-research/' },
  { label: 'Facebook', url: 'https://www.facebook.com/profile.php?id=61590870812390' },
  { label: 'Instagram', url: 'https://www.instagram.com/draftlaw_research/' },
  { label: 'X (Twitter)', url: '' },
  { label: 'YouTube', url: '' },
];
