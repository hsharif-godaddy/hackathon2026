// Analytics initialization
// This script loads the GoDaddy Signals analytics library
(window._signalsDataLayer=window._signalsDataLayer||[]);
(function(s){
  s.src=(location.hostname.includes('test-')||location.hostname.includes('dev-'))?'https://img1.test-wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js':'https://img1.wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js';
  s.async=true;
  document.head.appendChild(s);
})(document.createElement('script'));

