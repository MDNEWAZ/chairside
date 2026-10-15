// Apply the saved theme before first paint so there is no flash. Storage can be unavailable.
// A separate file (not inline) so the Content-Security-Policy can forbid inline scripts.
try { var t = localStorage.getItem('chairside.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
