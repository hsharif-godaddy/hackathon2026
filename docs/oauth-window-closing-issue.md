# OAuth Popup Window Closing Issue

## Problem

After OAuth authentication completes and redirects back to our callback URL, the popup window cannot reliably close itself automatically. The user must manually close the window.

## Why Automatic Closing Fails

OAuth flows involve cross-origin redirects (app → GoDaddy SSO → app callback), which triggers browser security restrictions:

1. **Script-opened window restriction**: Browsers only allow `window.close()` to work on windows that were "script-opened" AND haven't navigated cross-origin
2. **OAuth redirects are cross-origin**: User leaves our domain → GoDaddy SSO → returns to our callback
3. **Opener reference lost**: After cross-origin navigation, the window loses its "script-opened" status

This is intentional browser security to prevent malicious sites from closing windows unexpectedly.

## Attempted Solutions (All Failed)

### Attempt 1: Simple window.close()

```javascript
// In callback success page
setTimeout(() => window.close(), 2000);
```

**Result**: Silently fails after OAuth redirect. No error, window just stays open.

### Attempt 2: Remove noopener/noreferrer flags

```javascript
// Removed noopener and noreferrer from window.open()
window.open(url, name, features); // without noopener
```

**Result**: Still fails. The cross-origin redirect resets the relationship regardless of opener flags.

### Attempt 3: Opener closes popup (postMessage)

```javascript
// Popup sends message to opener
window.opener.postMessage({ type: "oauth:success", state }, origin);

// Opener listens and closes popup
popup.close(); // called from opener
```

**Result**: Still fails. Even the opener cannot close the popup after OAuth redirect has occurred.

### Attempt 4: Multiple close methods

```javascript
window.close();
window.open("", "_self").close();
window.opener?.close(); // etc
```

**Result**: None of these work after the cross-origin OAuth flow.

## Current Working Solution

**User manually closes the window** after seeing the success message.

The WebSocket notification to the agent works perfectly:

- Success page emits `oauth:result` via Socket.IO to backend
- Frontend `ChatAuthRequestMessage` component listens for `oauth:result`
- Agent automatically continues after receiving notification
- User experience: see "Authentication Successful" → close window → agent proceeds

## Why This Is Acceptable

1. **Agent flow continues automatically**: The WebSocket notification works perfectly, so the agent knows authentication succeeded and continues without user intervention
2. **Clear messaging**: Success page tells user "You can close this window now"
3. **Standard OAuth UX**: Many OAuth flows require manual window closing (GitHub, Google, etc.)
4. **Security trade-off**: The browser behavior exists for security reasons; fighting it creates more problems than it solves

## Alternative Approaches Not Pursued

### Browser Extension

Could inject scripts to close windows, but:

- Requires users to install extension
- Not practical for production SaaS

### Electron/Desktop App

Full control over windows, but:

- Wrong deployment model for our web app
- Massive architectural change

### Inline OAuth (no popup)

OAuth in main window with full page redirect, but:

- Disrupts user's workflow
- Loses application state
- Poor UX for our use case

## Code References

- **Callback endpoint**: `agents/src/server/routes/oauth.ts` - `/oauth/godaddy/callback`
- **Success page rendering**: `renderSuccessPage()` function
- **WebSocket notification**: `io.emit('oauth:result', ...)` - works perfectly
- **Frontend listener**: `app/src/app/develop/components/ChatAuthRequestMessage.tsx`
- **Popup opening**: `app/src/lib/oauth-popup.ts`

## Future Considerations

If automatic closing becomes critical:

1. **Investigate same-origin proxy**: Route OAuth through same-origin proxy to avoid cross-origin redirect
2. **Service Worker approach**: Use service worker to intercept OAuth callback before page loads
3. **WebSocket-only flow**: Don't use callback URL at all, coordinate entirely via WebSocket

However, given that the agent flow works perfectly with manual closing, these complex approaches are not justified.

## Related Issues

- Browser security: https://developer.mozilla.org/en-US/docs/Web/API/Window/close
- OAuth best practices: https://oauth.net/2/browser-based-apps/
- PostMessage security: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

---

**Last updated**: 2025-11-18
**Status**: Documented, no fix planned (manual closing is acceptable)
