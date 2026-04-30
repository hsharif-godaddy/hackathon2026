import type { Stagehand } from '@browserbasehq/stagehand';

// Get Page type from Stagehand's context (wraps Playwright Page)
type Page = ReturnType<Stagehand['context']['pages']>[0];


// Stagehand Page exposes these methods (per docs.stagehand.dev/v3/references/page)
// We don't need to cast - these are available on the Page type

/**
 * Credentials for login
 */
export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * Selectors for Airo Builder elements.
 * Based on tests/smoke/user-journey.spec.ts
 */
export const AIRO_SELECTORS = {
  // Homepage - uses data-testid
  promptInput: '[data-testid="homepage-prompt-input"]',
  // Sign-in iframe (production mode) - use ID for more reliable selection
  signInIframe: 'iframe#sso-deck-iframe',
  signInIframeAlt: 'iframe[title="Container for sign in"]',
};

/**
 * Helper to wait for a selector with timeout.
 */
async function waitForSelector(page: Page, selector: string, timeoutMs: number = 10000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to find and click a button by its text content or aria-label.
 */
async function clickButtonByText(page: Page, buttonText: string): Promise<boolean> {
  return page.evaluate((text) => {
    const buttons = document.querySelectorAll('button');
    const lowerText = text.toLowerCase();

    for (const button of buttons) {
      // Check text content
      const textContent = button.textContent?.trim().toLowerCase() || '';
      if (textContent === lowerText || textContent.includes(lowerText)) {
        button.click();
        return true;
      }

      // Check aria-label (for icon buttons)
      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel === lowerText || ariaLabel.includes(lowerText)) {
        button.click();
        return true;
      }

      // Check title attribute
      const title = button.getAttribute('title')?.toLowerCase() || '';
      if (title === lowerText || title.includes(lowerText)) {
        button.click();
        return true;
      }
    }
    return false;
  }, buttonText);
}

/**
 * Helper to fill an input field.
 * Uses native input value setter to work with React controlled inputs.
 */
async function fillInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, val }) => {
    const element = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!element) {
      console.log(`[fillInput] Element not found: ${sel}`);
      return false;
    }

    // Focus the element
    element.focus();

    // Clear existing value
    element.value = '';

    // Use the native value setter to bypass React's synthetic event handling
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, val);
    } else {
      element.value = val;
    }

    // Dispatch input event to trigger React state update
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Verify the value was set
    const success = element.value === val;
    console.log(`[fillInput] Set value: ${success}, length: ${element.value.length}`);
    return success;
  }, { sel: selector, val: value });
}

/**
 * Wait for URL to contain a pattern by polling.
 * Uses 1s interval to reduce unnecessary checks while still being responsive.
 */
async function waitForUrlPattern(page: Page, pattern: string, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    if (page.url().includes(pattern)) {
      return true;
    }
    await page.waitForTimeout(pollInterval);
  }
  return false;
}

/**
 * Login to GoDaddy SSO directly by navigating to the SSO page.
 * This avoids cross-origin iframe issues.
 */
async function loginToSSO(
  page: Page,
  credentials: LoginCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('  [Deterministic] Navigating to SSO login page...');
    await page.goto('https://sso.godaddy.com/login');

    // If SSO immediately redirects away from /login (already authenticated), continue.
    if (!page.url().includes('sso.godaddy.com/login')) {
      console.log(`  [Deterministic] SSO already authenticated, redirected to: ${page.url().substring(0, 60)}...`);
      return { success: true };
    }

    // Wait for the login form to load
    console.log('  [Deterministic] Waiting for login form...');
    try {
      await page.waitForSelector('input[type="text"]', { timeout: 30000, state: 'visible' });
    } catch {
      if (!page.url().includes('sso.godaddy.com/login')) {
        console.log(`  [Deterministic] SSO login inputs skipped, redirected to: ${page.url().substring(0, 60)}...`);
        return { success: true };
      }
      throw new Error('waitForSelector: Timeout 30000ms exceeded waiting for "input[type=\"text\"]" to be visible');
    }

    await page.waitForTimeout(1000);

    // Fill username (using native value setter for React)
    console.log('  [Deterministic] Filling username...');
    await page.evaluate(({ username }) => {
      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      if (input) {
        input.focus();

        // Use native value setter to bypass React
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, username);
        } else {
          input.value = username;
        }

        // Dispatch events React listens to
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log('[SSO] Username filled:', input.value.length, 'chars');
      }
    }, { username: credentials.username });

    await page.waitForTimeout(500);

    // Fill password (using native value setter for React)
    console.log('  [Deterministic] Filling password...');
    await page.evaluate(({ password }) => {
      const input = document.querySelector('input[type="password"]') as HTMLInputElement;
      if (input) {
        input.focus();

        // Use native value setter to bypass React
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, password);
        } else {
          input.value = password;
        }

        // Dispatch events React listens to
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log('[SSO] Password filled:', input.value.length, 'chars');
      }
    }, { password: credentials.password });

    await page.waitForTimeout(500);

    // Click Sign In button
    console.log('  [Deterministic] Clicking Sign In button...');
    const clicked = await page.evaluate(() => {
      // Try by ID first (most reliable)
      const submitBtn = document.querySelector('#submitBtn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.click();
        return true;
      }

      // Try buttons with "Sign In" text (including nested spans)
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('sign in')) {
          btn.click();
          return true;
        }
      }

      // Try any submit button
      const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submit) {
        submit.click();
        return true;
      }

      return false;
    });

    if (!clicked) {
      throw new Error('Could not find Sign In button');
    }

    console.log('  [Deterministic] Login submitted, waiting for redirect...');

    // Wait for login to complete (URL changes away from /login)
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds for login
    while (Date.now() - startTime < timeout) {
      const currentUrl = page.url();
      // Check if we've moved away from the login page
      if (!currentUrl.includes('sso.godaddy.com/login')) {
        console.log(`  [Deterministic] Login successful! Redirected to: ${currentUrl.substring(0, 60)}...`);
        return { success: true };
      }
      await page.waitForTimeout(1000);
    }

    throw new Error('Login timed out - still on SSO login page after 60 seconds');

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for deterministic setup
 */
export interface DeterministicSetupOptions {
  prompt: string;
  credentials?: LoginCredentials;
  handleLogin?: boolean;
}

const CHAT_SELECTORS = {
  inputCandidates: [
    '[data-testid="chat-input-textarea"]',
    'textarea[placeholder*="Ask Airo"]',
    'textarea[aria-label*="Ask Airo"]',
    'textarea[data-testid="chat-input"]',
    'main textarea',
  ],
  sendButtonCandidates: [
    '[data-testid="chat-send-button"]',
    'button[aria-label*="Send message"]',
    'button[title*="Send message"]',
  ],
};

/**
 * Deterministic action to login, enter a prompt, and click Start building.
 * Flow:
 *   1. If handleLogin=true: Navigate to SSO, login, then navigate to Airo
 *   2. Enter prompt
 *   3. Click Start building
 *   4. Wait for develop page (since already logged in, should go directly)
 *
 * @param page - Stagehand page object
 * @param options - Setup options including prompt, credentials, and whether to handle login
 * @param airoUrl - The Airo URL to navigate to after login
 */
export async function runDeterministicSetup(
  page: Page,
  options: DeterministicSetupOptions | string,
  airoUrl?: string
): Promise<{ success: boolean; error?: string }> {
  // Support legacy call with just prompt string
  const opts: DeterministicSetupOptions = typeof options === 'string'
    ? { prompt: options }
    : options;

  try {
    // Step 1: Login to SSO first (if enabled)
    if (opts.handleLogin && opts.credentials) {
      console.log('  [Deterministic] Step 1: Login to SSO first...');
      const loginResult = await loginToSSO(page, opts.credentials);
      if (!loginResult.success) {
        return loginResult;
      }

      // After login, navigate to Airo
      const targetUrl = airoUrl || 'https://airo-builder.godaddy.com';
      console.log(`  [Deterministic] Navigating to Airo: ${targetUrl}`);
      await page.goto(targetUrl);
      await page.waitForTimeout(2000);
    }

    // Step 2: Enter prompt and click Start building
    console.log('  [Deterministic] Step 2: Entering prompt and clicking Start building...');

    // Wait for the prompt input to be visible
    const inputFound = await waitForSelector(page, AIRO_SELECTORS.promptInput, 30000);
    if (!inputFound) {
      throw new Error('Could not find homepage prompt input (data-testid="homepage-prompt-input")');
    }
    console.log('  [Deterministic] Homepage loaded, found prompt input');

    // Fill the prompt input
    const filled = await fillInput(page, AIRO_SELECTORS.promptInput, opts.prompt);
    if (!filled) {
      throw new Error('Could not fill prompt input');
    }

    // Verify the prompt was actually entered
    const enteredValue = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      return el?.value || '';
    }, AIRO_SELECTORS.promptInput);

    if (enteredValue.length === 0) {
      console.log('  [Deterministic] WARNING: Prompt appears empty after fill, trying keyboard input...');
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        el?.click();
        el?.focus();
      }, AIRO_SELECTORS.promptInput);
      await page.waitForTimeout(100);

      // Type the prompt character by character
      await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
        if (!el) return;

        el.focus();
        for (const char of val) {
          const keydownEvent = new KeyboardEvent('keydown', { key: char, bubbles: true });
          const keypressEvent = new KeyboardEvent('keypress', { key: char, bubbles: true });
          const inputEvent = new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true });

          el.dispatchEvent(keydownEvent);
          el.dispatchEvent(keypressEvent);
          el.value += char;
          el.dispatchEvent(inputEvent);
          el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
      }, { sel: AIRO_SELECTORS.promptInput, val: opts.prompt });

      const retryValue = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
        return el?.value || '';
      }, AIRO_SELECTORS.promptInput);

      if (retryValue.length === 0) {
        throw new Error('Failed to enter prompt text after multiple attempts');
      }
      console.log(`  [Deterministic] Entered prompt via keyboard: "${opts.prompt.substring(0, 50)}..."`);
    } else {
      console.log(`  [Deterministic] Entered prompt: "${opts.prompt.substring(0, 50)}..." (${enteredValue.length} chars)`);
    }

    await page.waitForTimeout(500);

    // Click "Start building" button
    const clicked = await clickButtonByText(page, 'Start building');
    if (!clicked) {
      const buttonInfo = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        return Array.from(buttons).slice(0, 10).map(b => ({
          text: b.textContent?.trim().substring(0, 30),
          ariaLabel: b.getAttribute('aria-label'),
          disabled: b.disabled,
        }));
      });
      console.log('  [Deterministic] Available buttons:', JSON.stringify(buttonInfo, null, 2));
      throw new Error('Could not find or click "Start building" button');
    }
    console.log('  [Deterministic] Clicked Start building button');

    // Step 3: Wait for develop page (should go directly since already logged in)
    if (opts.handleLogin) {
      console.log('  [Deterministic] Step 3: Waiting for develop page...');
      const reachedDevelop = await waitForUrlPattern(page, '/develop/', 300000);
      if (!reachedDevelop) {
        throw new Error('Timed out waiting for develop page (5 minutes)');
      }
      console.log('  [Deterministic] Successfully reached develop page!');
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendDeterministicChatMessage(
  page: Page,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Wait until the initial build has likely completed enough for follow-up tool calls.
    const buildReadyStart = Date.now();
    while (Date.now() - buildReadyStart < 180000) {
      const ready = await page.evaluate(() => {
        const preview = document.querySelector(
          '[data-testid="preview-iframe"], iframe[title*="preview"], iframe[title*="Preview"]'
        );
        const stopButton = document.querySelector('[data-testid="chat-stop-button"]');
        return Boolean(preview) && !stopButton;
      });
      if (ready) {
        break;
      }
      await page.waitForTimeout(2000);
    }

    await page.waitForSelector('[data-testid="chat-input-textarea"]', { timeout: 120000, state: 'visible' });
    const readyStart = Date.now();
    while (Date.now() - readyStart < 120000) {
      const ready = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLTextAreaElement | null;
        if (!input) {
          return false;
        }
        const style = window.getComputedStyle(input);
        const visible = style.display !== 'none' && style.visibility !== 'hidden';
        return visible && !input.disabled;
      });
      if (ready) {
        break;
      }
      await page.waitForTimeout(1000);
    }

    const inputSelector = await page.evaluate((candidates) => {
      for (const selector of candidates) {
        const el = document.querySelector(selector) as HTMLTextAreaElement | null;
        if (!el) continue;
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled) {
          return selector;
        }
      }
      return null;
    }, CHAT_SELECTORS.inputCandidates);

    if (!inputSelector) {
      return { success: false, error: 'Could not find chat input textarea on develop page' };
    }

    const filled = await fillInput(page, inputSelector, message);
    if (!filled) {
      return { success: false, error: 'Failed to fill chat input' };
    }

    const sentByEnter = await page.evaluate((selector) => {
      const input = document.querySelector(selector) as HTMLTextAreaElement | null;
      if (!input) {
        return false;
      }
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      return true;
    }, inputSelector);

    const clickedBySelector = await page.evaluate((candidates) => {
      for (const selector of candidates) {
        const button = document.querySelector(selector) as HTMLButtonElement | null;
        if (!button || button.disabled) continue;
        button.click();
        return true;
      }
      return false;
    }, CHAT_SELECTORS.sendButtonCandidates);

    if (!clickedBySelector && !sentByEnter) {
      const clickedByText = await clickButtonByText(page, 'Send message');
      if (!clickedByText) {
        return { success: false, error: 'Could not click "Send message" button' };
      }
    }

    // Allow generation to start.
    await page.waitForTimeout(2000);

    // Wait for up to 3 minutes for generation to settle.
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const stillGenerating = await page.evaluate(() => {
        const stopButton = document.querySelector('[data-testid="chat-stop-button"]');
        const sendButton = document.querySelector('[data-testid="chat-send-button"]');
        const spinner = document.querySelector('[data-testid*="loading"], [class*="loading"], [class*="spinner"]');
        if (sendButton && !stopButton) {
          return false;
        }
        return Boolean(stopButton || spinner);
      });
      if (!stillGenerating) {
        break;
      }
      await page.waitForTimeout(2000);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export for separate use if needed
export { loginToSSO };
