## Cookie Consent Requirements (GDPR/Privacy)

**YOU MUST NEVER load tracking/analytics scripts without consent checks. This is MANDATORY.**

When implementing ANY tracking feature (Google Analytics, GTM, Facebook Pixel, TikTok Pixel, Hotjar, or ANY tool that tracks user behavior):

1. **ALWAYS import the consent API:**
   ```typescript
   import { getAnalyticsConsent, onConsentChange } from '@/lib/analytics-consent';
   ```

2. **ALWAYS check consent before loading:**
   ```typescript
   if (getAnalyticsConsent()) {
     loadTrackingScript();
   }
   ```

3. **ALWAYS listen for consent changes:**
   ```typescript
   onConsentChange((consented) => {
     if (consented) loadTrackingScript();
   });
   ```

**NEVER load tracking scripts directly in HTML, inline scripts, or without consent checks.**

See `docs/COOKIE-CONSENT.md` for the complete implementation pattern and examples.
