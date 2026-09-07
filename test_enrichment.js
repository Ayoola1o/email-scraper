const sampleHtml = `
  <html>
    <head><title>Apex Innovations Leadership</title></head>
    <body>
      <div class="team-member">
        <h3>Dr. Sarah Jenkins</h3>
        <p class="role">Chief Technology Officer & Co-Founder</p>
        <p>Email: sarah.jenkins@apex-innovations.com</p>
        <p>Direct Line: <a href="tel:+1-555-839-2049">+1 (555) 839-2049</a></p>
        <p>Connect: <a href="https://linkedin.com/in/sarah-jenkins-tech">LinkedIn</a> | <a href="https://github.com/sjenkins-dev">GitHub</a></p>
      </div>

      <div class="contact-footer">
        <p>Customer Support: support@apex-innovations.com or call +1 800 555 0199</p>
        <p>Twitter: https://x.com/ApexInnovations</p>
      </div>
    </body>
  </html>
`;

// Test extracting phones
function extractPhoneNumbers(text) {
  const phones = new Set();
  // 1. tel: links
  const telRegex = /href=["']tel:([^"']+)["']/gi;
  let match;
  while ((match = telRegex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (raw.length >= 7) phones.add(raw);
  }

  // 2. Text patterns
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  while ((match = phonePattern.exec(text)) !== null) {
    const p = match[0].trim();
    if (!p.includes('@') && !p.startsWith('202') && p.length >= 10) {
      phones.add(p);
    }
  }
  return Array.from(phones);
}

// Test extracting socials
function extractSocials(text) {
  const linkedinRegex = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9._%-]+/gi;
  const twitterRegex = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi;
  const githubRegex = /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9._%-]+/gi;

  const linkedin = text.match(linkedinRegex);
  const twitter = text.match(twitterRegex);
  const github = text.match(githubRegex);

  return {
    linkedin: linkedin ? linkedin[0] : undefined,
    twitter: twitter ? twitter[0] : undefined,
    github: github ? github[0] : undefined
  };
}

console.log('Phones found:', extractPhoneNumbers(sampleHtml));
console.log('Socials found:', extractSocials(sampleHtml));
