// =============================================
// PORTAL AUTHENTICATION
// Include this on all portal pages (except login)
// =============================================

(function() {
  // Check if we're on the login page
  if (window.location.pathname.includes('/portal/login')) {
    return;
  }
  
  // Check for session cookie (basic check - actual validation happens server-side)
  const hasSession = document.cookie.includes('portal_session=');
  
  if (!hasSession) {
    // Redirect to login
    window.location.href = '/portal/login.html';
    return;
  }
  
  // Add logout function to global scope
  window.portalLogout = async function() {
    try {
      await fetch('/api/portal-logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout error:', e);
    }
    
    // Clear cookie client-side as backup
    document.cookie = 'portal_session=; Path=/portal; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    
    window.location.href = '/portal/login.html';
  };
  
  // Add auth check to all API calls
  const originalFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const response = await originalFetch(url, options);
    
    // If we get a 401, redirect to login
    if (response.status === 401 && url.startsWith('/api/portal')) {
      window.location.href = '/portal/login.html?error=session_expired';
      return;
    }
    
    return response;
  };
})();
