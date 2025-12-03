/**
 * FullStory injector - only works in development mode
 * Follows the exact same pattern as dev tools injection
 */
export function injectFullStory() {
  // Only inject in development environment
  if (import.meta.env.MODE !== 'development') {
    return
  }

  // Don't inject on localhost
  if (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
       window.location.hostname === '127.0.0.1')) {
    return
  }

  // Check if already injected
  if ((window as any).__FULLSTORY_INJECTED__) {
    return
  }

  // Mark as injected
  ;(window as any).__FULLSTORY_INJECTED__ = true

  // FullStory initialization script with iframe support
  ;(window as any)['_fs_host'] = 'fullstory.com'
  ;(window as any)['_fs_script'] = 'edge.fullstory.com/s/fs.js'
  ;(window as any)['_fs_org'] = 'YKBRC'
  ;(window as any)['_fs_namespace'] = 'FS'
  
  // CRITICAL: Enable iframe mode if we're in an iframe
  // This must be set BEFORE FullStory initializes
  if (window !== window.top) {
    ;(window as any)['_fs_run_in_iframe'] = true
  }
  
  ;(function(m: any, n: any, e: any, t: any, l: any, o: any, g: any, y: any) {
    if (e in m) {
      if (m.console && m.console.log) { 
        m.console.log('FullStory namespace conflict. Please set window["_fs_namespace"].') 
      }
      return
    }
    g = m[e] = function(a: any, b: any, s: any) {
      g.q ? g.q.push([a, b, s]) : g._api(a, b, s)
    }
    g.q = []
    o = n.createElement(t)
    o.async = 1
    o.crossOrigin = 'anonymous'
    o.src = 'https://' + (window as any)['_fs_script']
    y = n.getElementsByTagName(t)[0]
    y.parentNode.insertBefore(o, y)
    
    g.identify = function(i: any, v: any, s: any) { g(l, {uid: i}, s); if (v) g(l, v, s) }
    g.setUserVars = function(v: any, s: any) { g(l, v, s) }
    g.event = function(i: any, v: any, s: any) { g('event', {n: i, p: v}, s) }
    g.anonymize = function() { g.identify(!!0) }
    g.shutdown = function() { g("rec", !1) }
    g.restart = function() { g("rec", !0) }
    g.log = function(a: any, b: any) { g("log", [a, b]) }
    g.consent = function(a: any) { g("consent", !arguments.length || a) }
    g.identifyAccount = function(i: any, v: any) { o = 'account'; v = v || {}; v.acctId = i; g(o, v) }
    g.clearUserCookie = function() {}
    g.setVars = function(n: any, p: any) { g('setVars', [n, p]) }
  })(window, document, (window as any)['_fs_namespace'], 'script', 'user', null, null, null)

  // Simple FullStory initialization - minimal approach
  const initializeFS = () => {
    if (typeof window !== 'undefined' && (window as any).FS && (window as any).FS.init) {
      // Initialize FullStory with essential iframe support
      ;(window as any).FS.init({ 
        orgId: 'YKBRC',
        recordCrossDomainIFrames: true
      })
      
      const mode = window !== window.top ? 'iframe' : 'standalone'
    } else {
      // Retry after short delay
      setTimeout(initializeFS, 100)
    }
  }

  // Initialize when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFS)
  } else {
    initializeFS()
  }
}

// Auto-inject on import in development (same as dev tools)
if (typeof window !== 'undefined') {
  injectFullStory()
}
