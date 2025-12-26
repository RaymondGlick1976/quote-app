// =============================================
// PORTAL VERIFY - Validate Magic Link & Create Session
// =============================================

const { getSupabase, success, error, handleCors, setSessionCookie, generateToken } = require('./utils');

exports.handler = async (event) => {
  // Handle CORS
  const corsResponse = handleCors(event);
  if (corsResponse) return corsResponse;
  
  // Get token from query string
  const token = event.queryStringParameters?.token;
  
  if (!token) {
    return {
      statusCode: 302,
      headers: { Location: '/portal/login.html?error=missing_token' },
    };
  }
  
  const supabase = getSupabase();
  
  try {
    // Find and validate token
    const { data: authToken, error: tokenError } = await supabase
      .from('auth_tokens')
      .select('*, customer:customers(*)')
      .eq('token', token)
      .eq('token_type', 'magic_link')
      .is('used_at', null)
      .single();
    
    if (tokenError || !authToken) {
      return {
        statusCode: 302,
        headers: { Location: '/portal/login.html?error=invalid_token' },
      };
    }
    
    // Check expiration
    if (new Date(authToken.expires_at) < new Date()) {
      return {
        statusCode: 302,
        headers: { Location: '/portal/login.html?error=expired_token' },
      };
    }
    
    // Mark magic link as used
    await supabase
      .from('auth_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', authToken.id);
    
    // Create session token
    const sessionToken = generateToken();
    const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    await supabase
      .from('auth_tokens')
      .insert({
        customer_id: authToken.customer_id,
        token: sessionToken,
        token_type: 'session',
        expires_at: sessionExpires.toISOString(),
        ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'],
        user_agent: event.headers['user-agent'],
      });
    
    // Update customer last login
    await supabase
      .from('customers')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', authToken.customer_id);
    
    // Log activity
    await supabase
      .from('activity_log')
      .insert({
        customer_id: authToken.customer_id,
        activity_type: 'login',
        description: 'Customer logged in via magic link',
        ip_address: event.headers['x-forwarded-for'] || event.headers['client-ip'],
      });
    
    // Redirect to dashboard with session cookie
    return {
      statusCode: 302,
      headers: {
        Location: '/portal/dashboard.html',
        'Set-Cookie': setSessionCookie(sessionToken),
      },
    };
    
  } catch (err) {
    console.error('Verify error:', err);
    return {
      statusCode: 302,
      headers: { Location: '/portal/login.html?error=invalid_token' },
    };
  }
};
