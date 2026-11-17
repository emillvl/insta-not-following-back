globalThis.F4FResultCopy = ({ heading, summary }) => ({
  heading: heading.replace(/^Seni Takip Etmeyenler(?= \()/, 'Not following you back'),
  summary: summary.replace(/^Takip Ettiğin:\s*(\d+)\s*\|\s*Takipçi:\s*(\d+)$/, 'Following $1 · Followers $2')
});
